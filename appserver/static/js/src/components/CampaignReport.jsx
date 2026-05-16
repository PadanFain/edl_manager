/**
 * components/CampaignReport.jsx
 * Read-only campaign intelligence view — groups IOCs by campaign tag,
 * shows hit counts and timeline. Data comes from /campaigns endpoint.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Table       from '@splunk/react-ui/Table';
import Button      from '@splunk/react-ui/Button';
import Text        from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Badge       from '@splunk/react-ui/Badge';
import api         from '../api/api';

export default function CampaignReport() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [expanded,  setExpanded]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = {};
    if (search.trim()) params.search = search.trim();
    const res = await api.campaigns.list(params);
    if (res.error) setError(res.error);
    else setCampaigns(res.data?.items || []);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const toggle = key => setExpanded(e => e === key ? null : key);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Campaign Intelligence</h2>
        <Button label="Refresh" onClick={load} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text
          placeholder="Search campaigns…"
          value={search}
          onChange={(_, { value }) => setSearch(value)}
          style={{ width: 300 }}
        />
      </div>

      {error   && <Message appearance="error" style={{ marginBottom: 8 }}>{error}</Message>}
      {loading && <WaitSpinner />}

      {!loading && (
        <Table stripeRows>
          <Table.Head>
            <Table.HeadCell>Campaign</Table.HeadCell>
            <Table.HeadCell>IOC Count</Table.HeadCell>
            <Table.HeadCell>Total Hits</Table.HeadCell>
            <Table.HeadCell>Types</Table.HeadCell>
            <Table.HeadCell>First seen</Table.HeadCell>
            <Table.HeadCell>Last hit</Table.HeadCell>
            <Table.HeadCell>Details</Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {campaigns.map(c => [
              <Table.Row key={c._key}>
                <Table.Cell><strong>{c.name || c._key}</strong></Table.Cell>
                <Table.Cell>{c.ioc_count ?? '—'}</Table.Cell>
                <Table.Cell>{c.total_hits ?? '—'}</Table.Cell>
                <Table.Cell>
                  {(c.types || []).map(t => <Badge key={t} style={{ marginRight: 4 }}>{t}</Badge>)}
                </Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{c.first_seen?.substring(0, 10) || '—'}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{c.last_hit?.substring(0, 10) || '—'}</Table.Cell>
                <Table.Cell>
                  <Button label={expanded === c._key ? 'Hide' : 'Show IOCs'} onClick={() => toggle(c._key)} />
                </Table.Cell>
              </Table.Row>,
              expanded === c._key && (
                <Table.Row key={`${c._key}_detail`}>
                  <Table.Cell colSpan={7} style={{ background: '#f9f9f9', padding: 12 }}>
                    {(c.iocs || []).length === 0
                      ? <span style={{ color: '#999' }}>No IOC details available.</span>
                      : (
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #ddd' }}>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>Value</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>Type</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>List</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px' }}>Hits</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.iocs.map((ioc, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '2px 8px', fontFamily: 'monospace' }}>{ioc.value}</td>
                                <td style={{ padding: '2px 8px' }}>{ioc.type}</td>
                                <td style={{ padding: '2px 8px' }}>{ioc.list_type}</td>
                                <td style={{ padding: '2px 8px' }}>{ioc.hit_count ?? 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                  </Table.Cell>
                </Table.Row>
              ),
            ])}
            {campaigns.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  No campaigns found. Tag IOCs with a campaign name to group them here.
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
