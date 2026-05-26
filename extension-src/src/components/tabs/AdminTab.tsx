import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { fetchAdminDashboard, fetchAdminUsers, fetchUserUsage, fetchUserPurchases, grantCredits, AdminDashboard, AdminUser, UsageRecord, PurchaseRecord } from '../../services/adminService';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  ApiKey,
  CreatedApiKey,
  AVAILABLE_SCOPES,
} from '../../services/apiKeysService';

const ADMIN_UID = 'cqNTaHoSMLgXGMsk1vXWxFYnTXH3';

type Section = 'overview' | 'users' | 'user-detail' | 'api-keys';
type ApiKeysView = 'list' | 'create-form' | 'reveal';

const REVEAL_CONFIRM_DELAY_MS = 3000;

const AdminTab: React.FC = () => {
  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Overview data
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);

  // Users data
  const [users, setUsers] = useState<AdminUser[]>([]);

  // User detail
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [grantAmount, setGrantAmount] = useState('');
  const [granting, setGranting] = useState(false);

  // API Keys section state
  const [apiKeysView, setApiKeysView] = useState<ApiKeysView>('list');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(AVAILABLE_SCOPES.map(s => s.id));
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [revealConfirmEnabled, setRevealConfirmEnabled] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    loadDashboard();
  }, []);

  // When entering reveal view, disable the "I've saved it" button for a few seconds
  // so users actually read the warning before dismissing the only-time-shown key.
  useEffect(() => {
    if (apiKeysView !== 'reveal') {
      setRevealConfirmEnabled(false);
      return;
    }
    setRevealConfirmEnabled(false);
    const t = setTimeout(() => setRevealConfirmEnabled(true), REVEAL_CONFIRM_DELAY_MS);
    return () => clearTimeout(t);
  }, [apiKeysView]);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDashboard();
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers();
      setUsers(data.filter(u => u.uid !== ADMIN_UID));
      setSection('users');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const viewUser = async (user: AdminUser) => {
    setSelectedUser(user);
    setSection('user-detail');
    setLoading(true);
    setError(null);
    try {
      const [usageData, purchaseData] = await Promise.all([
        fetchUserUsage(user.uid),
        fetchUserPurchases(user.uid),
      ]);
      setUsage(usageData);
      setPurchases(purchaseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user details');
    } finally {
      setLoading(false);
    }
  };

  // ── API Keys handlers ──

  const loadApiKeys = async () => {
    setApiKeysLoading(true);
    setError(null);
    try {
      const keys = await listApiKeys();
      setApiKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setApiKeysLoading(false);
    }
  };

  const openApiKeys = async () => {
    setSection('api-keys');
    setApiKeysView('list');
    await loadApiKeys();
  };

  const toggleScope = (scopeId: string) => {
    setKeyScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const handleCreateKey = async () => {
    const name = keyName.trim();
    if (!name) {
      setError('Key name is required');
      return;
    }
    if (keyScopes.length === 0) {
      setError('Select at least one scope');
      return;
    }
    setCreatingKey(true);
    setError(null);
    try {
      const created = await createApiKey(name, keyScopes, 'live');
      setRevealedKey(created);
      setApiKeysView('reveal');
      // Refresh list in the background so it's fresh when user returns
      loadApiKeys().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleCopyKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.rawKey);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      // Clipboard API can fail in some Chrome contexts; user can still select+copy manually.
    }
  };

  const handleRevealConfirmed = () => {
    setRevealedKey(null);
    setKeyName('');
    setKeyScopes(AVAILABLE_SCOPES.map((s) => s.id));
    setApiKeysView('list');
  };

  const handleRevokeClick = (keyId: string) => {
    if (confirmingRevokeId === keyId) {
      // second click → execute
      doRevoke(keyId);
    } else {
      setConfirmingRevokeId(keyId);
      // Auto-cancel confirm after 5 seconds
      setTimeout(() => {
        setConfirmingRevokeId((current) => (current === keyId ? null : current));
      }, 5000);
    }
  };

  const doRevoke = async (keyId: string) => {
    setRevokingKeyId(keyId);
    setError(null);
    try {
      await revokeApiKey(keyId);
      setConfirmingRevokeId(null);
      await loadApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingKeyId(null);
    }
  };

  const handleGrant = async () => {
    if (!selectedUser || !grantAmount) return;
    const amount = parseInt(grantAmount, 10);
    if (isNaN(amount) || amount < 1) return;

    setGranting(true);
    setError(null);
    try {
      const result = await grantCredits(selectedUser.uid, amount);
      setSelectedUser({ ...selectedUser, balance: result.balance });
      setGrantAmount('');
      // Refresh usage to show the grant
      const usageData = await fetchUserUsage(selectedUser.uid);
      setUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant credits');
    } finally {
      setGranting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  if (loading && !dashboard && section === 'overview') {
    return <div className="text-xs text-muted-foreground text-center py-4">Loading admin data...</div>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1.5">{error}</div>
      )}

      {/* Navigation */}
      <div className="flex gap-1">
        <Button
          variant={section === 'overview' ? 'default' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2"
          onClick={() => { setSection('overview'); loadDashboard(); }}
        >
          Overview
        </Button>
        <Button
          variant={section === 'users' ? 'default' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2"
          onClick={loadUsers}
        >
          Users
        </Button>
        {selectedUser && (
          <Button
            variant={section === 'user-detail' ? 'default' : 'ghost'}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setSection('user-detail')}
          >
            {selectedUser.email.split('@')[0]}
          </Button>
        )}
        <Button
          variant={section === 'api-keys' ? 'default' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2"
          onClick={openApiKeys}
        >
          API Keys
        </Button>
      </div>

      {/* Overview Section */}
      {section === 'overview' && dashboard && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold">Revenue</h3>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Stripe Revenue" value={`$${(dashboard.revenueCents / 100).toFixed(2)}`} />
            <StatCard label="Credits Sold" value={dashboard.realCreditsPurchased} />
          </div>

          <h3 className="text-xs font-semibold">Users (excl. admin)</h3>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Auth Users" value={dashboard.totalAuthUsers - 1} />
            <StatCard label="Credit Users" value={dashboard.totalCreditUsers - 1} />
            <StatCard label="User Balance" value={dashboard.userBalance} />
            <StatCard label="User Purchased" value={dashboard.userPurchased} />
            <StatCard label="User Used" value={dashboard.userUsed} />
          </div>

          <h3 className="text-xs font-semibold text-muted-foreground">Admin Account</h3>
          <div className="grid grid-cols-3 gap-1.5">
            <StatCard label="Balance" value={dashboard.adminBalance} />
            <StatCard label="Purchased" value={dashboard.adminPurchased} />
            <StatCard label="Used" value={dashboard.adminUsed} />
          </div>
        </div>
      )}

      {/* Users List */}
      {section === 'users' && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold">{users.length} Users</h3>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {users.map((u) => (
              <button
                key={u.uid}
                onClick={() => viewUser(u)}
                className="w-full text-left px-2 py-1.5 rounded border hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">{u.email || u.uid.slice(0, 12)}</span>
                  <span className="text-xs text-muted-foreground">{u.balance} cr</span>
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                  <span>Purchased: {u.totalPurchased}</span>
                  <span>Used: {u.totalUsed}</span>
                  <span>Joined: {formatDate(u.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* User Detail */}
      {section === 'user-detail' && selectedUser && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold truncate">{selectedUser.email}</h3>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={loadUsers}>
              Back
            </Button>
          </div>

          {/* User stats */}
          <div className="grid grid-cols-3 gap-1.5">
            <StatCard label="Balance" value={selectedUser.balance} />
            <StatCard label="Purchased" value={selectedUser.totalPurchased} />
            <StatCard label="Used" value={selectedUser.totalUsed} />
          </div>

          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div>UID: <span className="font-mono">{selectedUser.uid}</span></div>
            <div>Joined: {formatDate(selectedUser.createdAt)}</div>
            <div>Last sign-in: {formatDate(selectedUser.lastSignIn)}</div>
          </div>

          {/* Grant credits */}
          <div className="flex gap-1.5 items-center">
            <input
              type="number"
              min="1"
              placeholder="Amount"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              className="w-20 h-6 text-xs px-2 border rounded bg-background"
            />
            <Button
              size="sm"
              className="h-6 text-xs px-2"
              onClick={handleGrant}
              disabled={granting || !grantAmount}
            >
              {granting ? 'Granting...' : 'Grant Credits'}
            </Button>
          </div>

          {/* Purchases */}
          {purchases.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold mb-1">Purchases</h4>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {purchases.map((p) => (
                  <div key={p.id} className="flex justify-between text-[10px] px-1.5 py-1 bg-muted/30 rounded">
                    <span>{p.packLabel} ({p.credits} cr)</span>
                    <span className="text-muted-foreground">${((p.amountPaid || 0) / 100).toFixed(2)} &middot; {formatDateTime(p.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Usage log */}
          <div>
            <h4 className="text-[10px] font-semibold mb-1">Usage Log ({usage.length})</h4>
            {loading ? (
              <div className="text-[10px] text-muted-foreground">Loading...</div>
            ) : usage.length === 0 ? (
              <div className="text-[10px] text-muted-foreground">No usage records</div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {usage.map((u) => (
                  <div key={u.id} className="flex justify-between text-[10px] px-1.5 py-1 bg-muted/30 rounded">
                    <span className="truncate mr-2">
                      {u.action}
                      <span className="text-muted-foreground ml-1">
                        ({u.balanceBefore} → {u.balanceAfter})
                      </span>
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(u.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* API Keys Section */}
      {section === 'api-keys' && (
        <div className="space-y-3">
          {/* List view */}
          {apiKeysView === 'list' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">
                  Your API Keys ({apiKeys.filter((k) => !k.revokedAt).length} active)
                </h3>
                <Button
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setKeyName('');
                    setKeyScopes(AVAILABLE_SCOPES.map((s) => s.id));
                    setApiKeysView('create-form');
                  }}
                >
                  + Create key
                </Button>
              </div>

              <div className="text-[10px] text-muted-foreground">
                Keys authenticate the patent-search MCP server and any direct API calls.
                Each call from a key counts against your credit balance.
              </div>

              {apiKeysLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Loading keys...</div>
              ) : apiKeys.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4 border rounded">
                  No keys yet. Click "Create key" to mint your first one.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {apiKeys.map((k) => {
                    const isRevoked = !!k.revokedAt;
                    const isConfirming = confirmingRevokeId === k.keyId;
                    const isRevoking = revokingKeyId === k.keyId;
                    return (
                      <div
                        key={k.keyId}
                        className={`border rounded px-2 py-1.5 ${isRevoked ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">
                              {k.name}
                              {isRevoked && <span className="ml-1 text-[10px] text-red-500">(revoked)</span>}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground truncate">
                              {k.prefix}...
                            </div>
                          </div>
                          {!isRevoked && (
                            <Button
                              variant={isConfirming ? 'destructive' : 'ghost'}
                              size="sm"
                              className="h-5 text-[10px] px-1.5 shrink-0"
                              onClick={() => handleRevokeClick(k.keyId)}
                              disabled={isRevoking}
                            >
                              {isRevoking ? '...' : isConfirming ? 'Confirm?' : 'Revoke'}
                            </Button>
                          )}
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                          <span>Created: {formatDate(k.createdAt)}</span>
                          <span>Last used: {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'never'}</span>
                        </div>
                        {k.scopes.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            Scopes: {k.scopes.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Create form */}
          {apiKeysView === 'create-form' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">Create API Key</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5"
                  onClick={() => setApiKeysView('list')}
                >
                  Cancel
                </Button>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Name</label>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="e.g. MCP prod, Cursor workstation"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="w-full h-7 text-xs px-2 border rounded bg-background"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">
                    Scopes (which endpoints this key can call)
                  </label>
                  <div className="space-y-1 border rounded p-2">
                    {AVAILABLE_SCOPES.map((scope) => {
                      const checked = keyScopes.includes(scope.id);
                      return (
                        <label
                          key={scope.id}
                          className="flex items-start gap-2 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleScope(scope.id)}
                            className="mt-0.5"
                          />
                          <span className="flex-1">
                            <span className="font-medium">{scope.label}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {scope.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <Button
                className="w-full h-7 text-xs"
                onClick={handleCreateKey}
                disabled={creatingKey || !keyName.trim() || keyScopes.length === 0}
              >
                {creatingKey ? 'Creating...' : 'Create key'}
              </Button>
            </>
          )}

          {/* Reveal view — shows raw key once */}
          {apiKeysView === 'reveal' && revealedKey && (
            <>
              <div className="text-xs font-semibold text-green-600">
                Key created — save it now
              </div>

              <div className="text-[10px] text-red-500 bg-red-500/10 rounded px-2 py-1.5">
                This is the only time the full key will be shown. Save it to your MCP client
                config or a password manager before continuing. Lost keys can't be recovered —
                only revoked and replaced.
              </div>

              <div>
                <div className="text-[10px] text-muted-foreground mb-1">{revealedKey.name}</div>
                <div className="font-mono text-[11px] break-all border rounded p-2 bg-muted/30 select-all">
                  {revealedKey.rawKey}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 flex-1"
                  onClick={handleCopyKey}
                >
                  {copyStatus === 'copied' ? '✓ Copied' : 'Copy to clipboard'}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2 flex-1"
                  onClick={handleRevealConfirmed}
                  disabled={!revealConfirmEnabled}
                >
                  {revealConfirmEnabled ? "I've saved it" : 'Read first...'}
                </Button>
              </div>

              <div className="text-[10px] text-muted-foreground">
                Add it to your MCP client config as the <code>PATENT_SEARCH_API_KEY</code> env var.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="border rounded px-2 py-1.5 text-center">
    <div className="text-sm font-bold">{value}</div>
    <div className="text-[10px] text-muted-foreground">{label}</div>
  </div>
);

export default AdminTab;
