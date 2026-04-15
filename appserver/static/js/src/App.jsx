/**
 * App.jsx — v1.1
 * Root application component. Manages tab routing and shared policy/conflict state.
 * Tabs: Dashboard, IOC Entries, Bulk Import, Feed Endpoints, TAXII Sources,
 *       Conflicts, Policies, Tokens, Audit Log, Attack Map, Campaigns
 */

import React, { useState, useEffect, useCallback } from 'react';
import TabLayout   from '@splunk/react-ui/TabLayout';
import Message     from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Badge       from '@splunk/react-ui/Badge';

import api             from './api/api';
import IOCTable        from './components/IOCTable';
import PolicyManager   from './components/PolicyManager';
import BulkImport      from './components/BulkImport';
import Dashboard       from './components/Dashboard';
import AuditLog        from './components/AuditLog';
import TAXIIManager    from './components/TAXIIManager';
import ConflictManager from './components/ConflictManager';
import TokenManager    from './components/TokenManager';
import AttackMap       from './components/AttackMap';
import CampaignReport  from './components/CampaignReport';
import FeedManager     from './components/FeedManager';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <Message appearance="error">
          An unexpected error occurred: {this.state.error?.message || 'Unknown'}.
          Please refresh the page.
        </Message>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [activeTab,       setActiveTab]       = useState('dashboard');
  const [policies,        setPolicies]        = useState([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError,   setPoliciesError]   = useState(null);
  const [openConflicts,   setOpenConflicts]   = useState(0);

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    const res = await api.policies.list();
    if (res.error) { setPoliciesError(res.error); }
    else           { setPolicies(res.data?.items || []); setPoliciesError(null); }
    setPoliciesLoading(false);
  }, []);

  const loadConflicts = useCallback(async () => {
    const res = await api.conflicts.list({ state: 'open' });
    if (!res.error) setOpenConflicts(res.data?.total_count || 0);
  }, []);

  useEffect(() => {
    loadPolicies();
    loadConflicts();
    const interval = setInterval(loadConflicts, 60000);
    return () => clearInterval(interval);
  }, [loadPolicies, loadConflicts]);

  const handleTabChange = useCallback((_, { selectedTabId }) => {
    setActiveTab(selectedTabId);
  }, []);

  if (policiesLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <WaitSpinner size="large" />
        <p style={{ marginTop: 16, color: '#666' }}>Loading EDL Manager…</p>
      </div>
    );
  }

  if (policiesError && policies.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Message appearance="error">
          Failed to load policies: {policiesError}.
          Ensure the app is installed correctly and you have the
          <code>edl_read</code> capability.
        </Message>
      </div>
    );
  }

  const conflictBadge = openConflicts > 0
    ? <Badge appearance="destructive" style={{ marginLeft: 6 }}>{openConflicts}</Badge>
    : null;

  return (
    <div style={{ padding: '0 8px' }}>
      {policiesError && (
        <Message appearance="warning" style={{ marginBottom: 8 }}>
          Warning: {policiesError}
        </Message>
      )}
      <div className="edl-app">
        <TabLayout
          activePanelId={activeTab}
          onChange={handleTabChange}
          style={{ minHeight: 600 }}
        >
          <TabLayout.Panel label="Dashboard"  panelId="dashboard">
            <ErrorBoundary><Dashboard onTabChange={setActiveTab} /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="IOC Entries" panelId="iocs">
            <ErrorBoundary>
              <IOCTable
                policies={policies}
                onConflictsChanged={loadConflicts}
              />
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Bulk Import" panelId="import">
            <ErrorBoundary>
              <BulkImport policies={policies} />
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Feed Endpoints" panelId="feed">
            <ErrorBoundary><FeedManager /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="TAXII Sources" panelId="taxii">
            <ErrorBoundary><TAXIIManager policies={policies} /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel
            label={<span>Conflicts{conflictBadge}</span>}
            panelId="conflicts"
          >
            <ErrorBoundary>
              <ConflictManager onResolved={loadConflicts} />
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Policies" panelId="policies">
            <ErrorBoundary>
              <PolicyManager
                policies={policies}
                onChanged={loadPolicies}
              />
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Tokens" panelId="tokens">
            <ErrorBoundary><TokenManager /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Audit Log" panelId="audit">
            <ErrorBoundary><AuditLog /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Attack Map" panelId="map">
            <ErrorBoundary><AttackMap /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Campaigns" panelId="campaigns">
            <ErrorBoundary><CampaignReport /></ErrorBoundary>
          </TabLayout.Panel>
        </TabLayout>
      </div>
    </div>
  );
}
