import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { fetchAdminDashboard, fetchAdminUsers, fetchUserUsage, fetchUserPurchases, grantCredits, AdminDashboard, AdminUser, UsageRecord, PurchaseRecord } from '../../services/adminService';

const ADMIN_UID = 'cqNTaHoSMLgXGMsk1vXWxFYnTXH3';

type Section = 'overview' | 'users' | 'user-detail';

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

  useEffect(() => {
    loadDashboard();
  }, []);

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
