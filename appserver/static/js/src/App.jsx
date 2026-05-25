/**
 * App.jsx — v1.2
 * Root application component. Manages tab routing and shared policy/conflict state.
 *
 * FIX: Removed early-return gates for policiesLoading / policiesError.
 * Previously, setting policiesLoading=true unmounted the entire TabLayout,
 * resetting activeTab to 'dashboard' and blanking the content area on every
 * tab click that triggered a reload. Now the TabLayout always stays mounted;
 * loading/error state is shown inline inside the Policies panel only.
 */

import React, { useState, useEffect, useCallback } from 'react';
import TabLayout   from '@splunk/react-ui/TabLayout';
import Message     from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Chip        from '@splunk/react-ui/Chip';

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

  const conflictBadge = openConflicts > 0
    ? <Chip appearance="destructive" style={{ marginLeft: 6 }}>{openConflicts}</Chip>
    : null;

  const policiesNode = policiesLoading
    ? <div style={{ padding: 40, textAlign: 'center' }}><WaitSpinner size="large" /></div>
    : policiesError && policies.length === 0
      ? (
        <Message appearance="error" style={{ margin: 16 }}>
          Failed to load policies: {policiesError}.{' '}
          Ensure the app is installed correctly and you have the{' '}
          <code>edl_read</code> capability.
        </Message>
      )
      : null;

  return (
    <div style={{ padding: '0 8px' }}>
      {policiesError && policies.length > 0 && (
        <Message appearance="warning" style={{ marginBottom: 8 }}>
          Warning: could not refresh policies — {policiesError}
        </Message>
      )}

      <div className="edl-app">
        <TabLayout
          activePanelId={activeTab}
          onChange={handleTabChange}
          style={{ minHeight: 600 }}
        >
          <TabLayout.Panel label="Dashboard" panelId="dashboard">
            <ErrorBoundary><Dashboard onTabChange={setActiveTab} /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="IOC Entries" panelId="iocs">
            <ErrorBoundary>
              {policiesNode || (
                <IOCTable
                  policies={policies}
                  onConflictsChanged={loadConflicts}
                />
              )}
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Bulk Import" panelId="import">
            <ErrorBoundary>
              {policiesNode || <BulkImport policies={policies} />}
            </ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="Feed Endpoints" panelId="feed">
            <ErrorBoundary><FeedManager /></ErrorBoundary>
          </TabLayout.Panel>

          <TabLayout.Panel label="TAXII Sources" panelId="taxii">
            <ErrorBoundary>
              {policiesNode || <TAXIIManager policies={policies} />}
            </ErrorBoundary>
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
              {policiesNode || (
                <PolicyManager
                  policies={policies}
                  onChanged={loadPolicies}
                />
              )}
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
