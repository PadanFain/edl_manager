/**
 * components/Dashboard.jsx
 * Landing tab — live stats cards + quick-action links.
 * Polls /stats every 30 s. onTabChange lets cards navigate to other tabs.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Card        from '@splunk/react-ui/Card';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Button      from '@splunk/react-ui/Button';
import api         from '../api/api';

const STAT_CARDS = [
  { key: 'active_iocs',    label: 'Active IOCs',      tab: 'iocs',      color: '#1a9d6f' },
  { key: 'block_count',    label: 'Block Entries',     tab: 'iocs',      color: '#d41f1f' },
  { key: 'allow_count',    label: 'Allow Entries',     tab: 'iocs',      color: '#2196f3' },
  { key: 'open_conflicts', label: 'Open Conflicts',    tab: 'conflicts', color: '#e67e22' },
  { key: 'expiring_24h',   label: 'Expiring <24h',    tab: 'iocs',      color: '#9b59b6' },
  { key: 'taxii_sources',  label: 'TAXII Sources',     tab: 'taxii',     color: '#555' },
];

export default function Dashboard({ onTabChange }) {
  const [stats,   setStats]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    const res = await api.stats.get();
    if (res.error) setError(res.error);
    else { setStats(res.data || {}); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><WaitSpinner size="large" /></div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 8 }}>EDL Manager Dashboard</h2>
      {error && <Message appearance="warning" style={{ marginBottom: 12 }}>Could not load stats: {error}</Message>}

      {/* Stat cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        {STAT_CARDS.map(({ key, label, tab, color }) => (
          <Card
            key={key}
            style={{ width: 160, cursor: 'pointer', borderTop: `4px solid ${color}` }}
            onClick={() => onTabChange(tab)}
          >
            <Card.Header title={label} />
            <Card.Body>
              <div style={{ fontSize: 32, fontWeight: 700, color }}>
                {stats[key] ?? '—'}
              </div>
            </Card.Body>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <h3 style={{ marginBottom: 8 }}>Quick Actions</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button appearance="primary" label="Add IOC"     onClick={() => onTabChange('iocs')} />
        <Button label="Bulk Import"  onClick={() => onTabChange('import')} />
        <Button label="Feed URLs"    onClick={() => onTabChange('feed')} />
        <Button label="Resolve Conflicts" onClick={() => onTabChange('conflicts')} />
      </div>

      {/* Recent activity summary */}
      {stats.recent_actions && stats.recent_actions.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Recent Activity</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {stats.recent_actions.slice(0, 8).map((a, i) => (
              <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid #eee', fontSize: 13 }}>
                <span style={{ color: '#888', marginRight: 8 }}>{a.timestamp_iso?.substring(0, 19)}</span>
                <strong>{a.actor}</strong> {a.action} {a.target_type} <em>{a.target_value}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
