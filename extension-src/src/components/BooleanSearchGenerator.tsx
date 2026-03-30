import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import UnifiedSearchTab from './tabs/UnifiedSearchTab';
import ConceptMapperTab from './tabs/ConceptMapperTab';
import ToolsTab from './tabs/ToolsTab';
import CreditsTab from './tabs/CreditsTab';
import AdminTab from './tabs/AdminTab';
import { useAuthContext } from '../contexts/AuthContext';

export interface TechnicalSynonyms {
  [key: string]: string[];
}

interface Fields {
  [key: string]: string;
}

export const fields: Fields = {
  'ALL': '',
  'Title': 'TI=',
  'Abstract': 'AB=',
  'Claims': 'CL=',
  'Full Text': 'FT=',
  'Title, Abstract, and Claims': 'TAC='
};

export const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now']);

type ConnectionStatus = 'disconnected' | 'checking' | 'connected' | 'wrong-page';

interface BooleanSearchGeneratorProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const ADMIN_UID = 'cqNTaHoSMLgXGMsk1vXWxFYnTXH3';

const BooleanSearchGenerator: React.FC<BooleanSearchGeneratorProps> = ({ activeTab, onTabChange }) => {
  const { user } = useAuthContext();
  const isAdmin = user?.uid === ADMIN_UID;
  const [searchSystem, setSearchSystem] = useState<string>('google-patents');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectedUrl, setConnectedUrl] = useState<string>('');

  const checkConnection = useCallback(async (): Promise<boolean> => {
    setConnectionStatus('checking');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url?.includes('patents.google.com')) {
        setConnectionStatus('wrong-page');
        setConnectedUrl(tab?.url || '');
        return false;
      }
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      if (response?.status === 'ok') {
        setConnectionStatus('connected');
        setConnectedUrl(response.url);
        return true;
      } else {
        setConnectionStatus('disconnected');
        return false;
      }
    } catch {
      setConnectionStatus('disconnected');
      return false;
    }
  }, []);

  const openGooglePatents = useCallback(async () => {
    const LANDING_URL = 'https://patents.google.com/?num=100';
    const tabs = await chrome.tabs.query({ url: 'https://patents.google.com/*' });
    let targetTabId: number;

    if (tabs.length > 0 && tabs[0].id) {
      // Reuse existing tab — navigate to landing page to get fresh content script
      targetTabId = tabs[0].id;
      await chrome.tabs.update(targetTabId, { active: true, url: LANDING_URL });
    } else {
      // Open new tab
      const newTab = await chrome.tabs.create({ url: LANDING_URL });
      targetTabId = newTab.id!;
    }

    // Wait for tab to finish loading then check connection
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === targetTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(checkConnection, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }, [checkConnection]);

  // On mount: check connection, auto-navigate if not on Google Patents
  useEffect(() => {
    const init = async () => {
      const connected = await checkConnection();
      if (!connected) {
        openGooglePatents();
      }
    };
    init();
  }, [checkConnection, openGooglePatents]);

  const statusConfig = {
    'disconnected': { color: 'bg-red-500', text: 'Not connected' },
    'checking': { color: 'bg-yellow-500', text: 'Checking...' },
    'connected': { color: 'bg-green-500', text: 'Connected' },
    'wrong-page': { color: 'bg-yellow-500', text: 'Not on Google Patents' },
  };

  const status = statusConfig[connectionStatus];

  return (
    <div className="w-full flex flex-col">
      {/* Connection Status Bar */}
      <div className="mb-2 flex items-center justify-between bg-secondary/50 rounded-md px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status.color}`} />
          <span className="text-xs text-muted-foreground">{status.text}</span>
        </div>
        <div className="flex gap-1">
          {connectionStatus === 'wrong-page' || connectionStatus === 'disconnected' ? (
            <Button variant="ghost" size="sm" className="h-5 text-xs px-2" onClick={openGooglePatents}>
              Open Patents
            </Button>
          ) : null}
          <Button
            variant={activeTab === 'credits' ? 'default' : 'ghost'}
            size="sm"
            className="h-5 text-xs px-2"
            onClick={() => onTabChange?.(activeTab === 'credits' ? 'search' : 'credits')}
          >
            Credits
          </Button>
          <Button variant="ghost" size="sm" className="h-5 text-xs px-2" onClick={checkConnection}>
            Refresh
          </Button>
        </div>
      </div>

      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Patent Boolean Search</CardTitle>
            <Select value={searchSystem} onValueChange={setSearchSystem}>
              <SelectTrigger className="w-36 text-xs">
                <SelectValue placeholder="Select system" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="orbit">Orbit / Quartet</SelectItem>
                <SelectItem value="google-patents">Google Patents</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardDescription className="text-xs">
            Generate complex Boolean searches for patent databases
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-3">
          <Tabs value={activeTab || 'search'} onValueChange={onTabChange} className="space-y-3">
            <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} h-8`}>
              <TabsTrigger value="search" className="text-xs px-1">Search</TabsTrigger>
              <TabsTrigger value="ai-analysis" className="text-xs px-1">Concepts <span className="ml-0.5 text-[8px] font-bold px-1 py-px rounded bg-gradient-to-r from-blue-500 to-purple-500 text-white leading-none">PRO</span></TabsTrigger>
              <TabsTrigger value="tools" className="text-xs px-1">Tools</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin" className="text-xs px-1">Admin</TabsTrigger>}
            </TabsList>

            {/* forceMount keeps state alive across tab switches; style hides inactive tabs */}
            <TabsContent value="search" forceMount style={(activeTab || 'search') !== 'search' ? { display: 'none' } : undefined}>
              <UnifiedSearchTab />
            </TabsContent>

            <TabsContent value="ai-analysis" forceMount style={(activeTab || 'search') !== 'ai-analysis' ? { display: 'none' } : undefined}>
              <ConceptMapperTab />
            </TabsContent>

            <TabsContent value="tools" forceMount style={(activeTab || 'search') !== 'tools' ? { display: 'none' } : undefined}>
              <ToolsTab />
            </TabsContent>

            <TabsContent value="credits" forceMount style={(activeTab || 'search') !== 'credits' ? { display: 'none' } : undefined}>
              <CreditsTab />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="admin" forceMount style={(activeTab || 'search') !== 'admin' ? { display: 'none' } : undefined}>
                <AdminTab />
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default BooleanSearchGenerator;
