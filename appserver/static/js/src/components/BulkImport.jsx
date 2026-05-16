/**
 * components/BulkImport.jsx
 * CSV / text paste bulk IOC import with preview, validation feedback,
 * and csvParser for flexible column mapping.
 */
import React, { useState, useCallback } from 'react';
import Button      from '@splunk/react-ui/Button';
import Select      from '@splunk/react-ui/Select';
import Text        from '@splunk/react-ui/Text';
import TextArea    from '@splunk/react-ui/TextArea';
import Message     from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Table       from '@splunk/react-ui/Table';
import Badge       from '@splunk/react-ui/Badge';
import api         from '../api/api';

// Simple CSV parser — handles quoted fields, trims whitespace
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  return lines.map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });
}

// Detect type from value heuristic
function guessType(value) {
  if (/^https?:\/\//i.test(value)) return 'url';
  if (/^(\d{1,3}\.){3}\d{1,3}(\/\d+)?$|^[0-9a-fA-F:]+$/.test(value)) return 'ip';
  return 'domain';
}

const MODES = [['paste', 'Paste text (one per line or CSV)'], ['csv', 'CSV with headers']];

export default function BulkImport({ policies }) {
  const [mode,       setMode]       = useState('paste');
  const [raw,        setRaw]        = useState('');
  const [listType,   setListType]   = useState('block');
  const [defPolicy,  setDefPolicy]  = useState('');
  const [parsed,     setParsed]     = useState(null);   // preview rows
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);

  const preview = useCallback(() => {
    setError(null); setResult(null);
    if (!raw.trim()) { setError('Paste some data first.'); return; }

    let rows = [];
    if (mode === 'paste') {
      // One value per line
      rows = raw.trim().split(/\r?\n/)
        .map(l => l.trim()).filter(Boolean)
        .map(v => ({ value: v, type: guessType(v), list_type: listType, status: 'active' }));
    } else {
      // CSV with headers: value, type, list_type, description, tags, policy_names
      const grid = parseCSV(raw);
      if (grid.length < 2) { setError('CSV needs a header row + at least one data row.'); return; }
      const headers = grid[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
      rows = grid.slice(1).map(cols => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
        return {
          value:        obj.value || '',
          type:         obj.type  || guessType(obj.value || ''),
          list_type:    obj.list_type || listType,
          status:       obj.status || 'active',
          description:  obj.description || '',
          tags:         obj.tags ? obj.tags.split('|').map(t => t.trim()) : [],
          policy_names: obj.policy_names
            ? obj.policy_names.split('|').map(p => p.trim())
            : (defPolicy ? [defPolicy] : []),
        };
      }).filter(r => r.value);
    }

    if (defPolicy && mode === 'paste') {
      rows = rows.map(r => ({ ...r, policy_names: [defPolicy] }));
    }

    setParsed(rows);
  }, [raw, mode, listType, defPolicy]);

  const doImport = useCallback(async () => {
    if (!parsed?.length) return;
    setImporting(true); setResult(null); setError(null);
    const res = await api.import.submit({ items: parsed });
    setImporting(false);
    if (res.error) { setError(res.error); return; }
    setResult(res.data);
    setParsed(null);
    setRaw('');
  }, [parsed]);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 12 }}>Bulk Import</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <label>Mode<br />
          <Select value={mode} onChange={(_, { value }) => { setMode(value); setParsed(null); }} style={{ width: 240 }}>
            {MODES.map(([v,l]) => <Select.Option key={v} value={v} label={l} />)}
          </Select>
        </label>
        <label>Default list type<br />
          <Select value={listType} onChange={(_, { value }) => setListType(value)} style={{ width: 120 }}>
            <Select.Option value="block" label="Block" />
            <Select.Option value="allow" label="Allow" />
          </Select>
        </label>
        <label>Default policy<br />
          <Select value={defPolicy} onChange={(_, { value }) => setDefPolicy(value)} style={{ width: 200 }}>
            <Select.Option value="" label="(none)" />
            {policies.map(p => <Select.Option key={p._key} value={p.name} label={p.name} />)}
          </Select>
        </label>
      </div>

      <TextArea
        value={raw}
        onChange={(_, { value }) => { setRaw(value); setParsed(null); }}
        placeholder={mode === 'paste'
          ? 'One IOC per line: 1.2.3.4\nevil.com\nhttps://bad.example/path'
          : 'value,type,list_type,description,tags,policy_names\n1.2.3.4,ip,block,,,'}
        style={{ width: '100%', fontFamily: 'monospace', minHeight: 160 }}
        rowsMin={6}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <Button appearance="primary" label="Preview" onClick={preview} />
        {parsed && (
          <Button
            appearance="primary"
            label={importing ? 'Importing…' : `Import ${parsed.length} IOCs`}
            onClick={doImport}
            disabled={importing}
          />
        )}
        {parsed && <Button label="Clear" onClick={() => setParsed(null)} />}
      </div>

      {error  && <Message appearance="error"   style={{ marginTop: 12 }}>{error}</Message>}

      {result && (
        <Message appearance={result.failed > 0 ? 'warning' : 'success'} style={{ marginTop: 12 }}>
          Imported {result.success} / {result.success + result.failed} IOCs.
          {result.failed > 0 && ` ${result.failed} failed — check the table below.`}
        </Message>
      )}

      {/* Preview table */}
      {parsed && (
        <div style={{ marginTop: 16 }}>
          <h3>Preview — {parsed.length} rows</h3>
          <Table stripeRows>
            <Table.Head>
              <Table.HeadCell>Value</Table.HeadCell>
              <Table.HeadCell>Type</Table.HeadCell>
              <Table.HeadCell>List</Table.HeadCell>
              <Table.HeadCell>Policy</Table.HeadCell>
            </Table.Head>
            <Table.Body>
              {parsed.slice(0, 50).map((r, i) => (
                <Table.Row key={i}>
                  <Table.Cell style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.value}</Table.Cell>
                  <Table.Cell><Badge>{r.type}</Badge></Table.Cell>
                  <Table.Cell>
                    <Badge appearance={r.list_type === 'block' ? 'destructive' : 'info'}>{r.list_type}</Badge>
                  </Table.Cell>
                  <Table.Cell style={{ fontSize: 12 }}>{(r.policy_names || []).join(', ') || '—'}</Table.Cell>
                </Table.Row>
              ))}
              {parsed.length > 50 && (
                <Table.Row>
                  <Table.Cell colSpan={4} style={{ textAlign: 'center', color: '#888' }}>
                    … and {parsed.length - 50} more
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
