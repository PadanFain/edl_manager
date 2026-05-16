/**
 * components/IOCTable.jsx
 * Full IOC list: filters, pagination, inline CRUD, bulk actions.
 * Uses useIOCs hook for all data/state management.
 */
import React, { useState, useCallback } from 'react';
import Table        from '@splunk/react-ui/Table';
import Select       from '@splunk/react-ui/Select';
import Text         from '@splunk/react-ui/Text';
import Button       from '@splunk/react-ui/Button';
import WaitSpinner  from '@splunk/react-ui/WaitSpinner';
import Message      from '@splunk/react-ui/Message';
import Paginator    from '@splunk/react-ui/Paginator';
import Badge        from '@splunk/react-ui/Badge';
import Checkbox     from '@splunk/react-ui/Checkbox';
import Modal        from '@splunk/react-ui/Modal';
import useIOCs      from '../hooks/useIOCs';
import BulkActionBar from './BulkActionBar';
import IOCForm       from './IOCForm';

const TYPE_OPTS      = [['','All types'],['ip','IP'],['url','URL'],['domain','Domain']];
const LIST_TYPE_OPTS = [['','All'],['block','Block'],['allow','Allow']];
const STATUS_OPTS    = [['','All statuses'],['active','Active'],['inactive','Inactive']];
const CONFLICT_OPTS  = [['','Any'],['none','None'],['conflict','Conflict'],['resolved','Resolved']];

const STATUS_COLOR = { active: '#1a9d6f', inactive: '#888', expired: '#d41f1f', scheduled: '#2196f3' };

export default function IOCTable({ policies, onConflictsChanged }) {
  const {
    iocs, totalCount, totalPages, page, setPage,
    filters, updateFilter, resetFilters,
    selected, toggleSelect, selectAll, clearSelection,
    loading, error, initialized,
    deleteIOC, bulkAction, createIOC, updateIOC,
    refresh,
  } = useIOCs({ pageSize: 50 });

  const [showForm,   setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [formError,  setFormError]  = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);

  const openCreate = () => { setEditTarget(null); setFormError(null); setShowForm(true); };
  const openEdit   = ioc => { setEditTarget(ioc); setFormError(null); setShowForm(true); };
  const closeForm  = () => setShowForm(false);

  const handleFormSubmit = useCallback(async data => {
    const res = editTarget
      ? await updateIOC(editTarget._key, data)
      : await createIOC(data);
    if (res.error) { setFormError(res.error); return; }
    setShowForm(false);
    onConflictsChanged();
  }, [editTarget, createIOC, updateIOC, onConflictsChanged]);

  const handleDelete = useCallback(async () => {
    if (!delConfirm) return;
    await deleteIOC(delConfirm._key);
    setDelConfirm(null);
    onConflictsChanged();
  }, [delConfirm, deleteIOC, onConflictsChanged]);

  const handleBulk = useCallback(async (action, extra) => {
    await bulkAction(action, extra);
    onConflictsChanged();
  }, [bulkAction, onConflictsChanged]);

  const allSelected = iocs.length > 0 && iocs.every(i => selected.has(i._key));

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>IOC Entries <span style={{ fontSize: 14, color: '#888', fontWeight: 400 }}>({totalCount} total)</span></h2>
        <Button appearance="primary" label="+ Add IOC" onClick={openCreate} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Text placeholder="Search value…" value={filters.search}
          onChange={(_, { value }) => updateFilter('search', value)} style={{ width: 200 }} />
        {TYPE_OPTS.map(([v,l]) => null) /* rendered via Select below */}
        <Select value={filters.type} onChange={(_, { value }) => updateFilter('type', value)} style={{ width: 120 }}>
          {TYPE_OPTS.map(([v,l]) => <Select.Option key={v} value={v} label={l} />)}
        </Select>
        <Select value={filters.list_type} onChange={(_, { value }) => updateFilter('list_type', value)} style={{ width: 110 }}>
          {LIST_TYPE_OPTS.map(([v,l]) => <Select.Option key={v} value={v} label={l} />)}
        </Select>
        <Select value={filters.status} onChange={(_, { value }) => updateFilter('status', value)} style={{ width: 130 }}>
          {STATUS_OPTS.map(([v,l]) => <Select.Option key={v} value={v} label={l} />)}
        </Select>
        <Select value={filters.conflict_state} onChange={(_, { value }) => updateFilter('conflict_state', value)} style={{ width: 130 }}>
          {CONFLICT_OPTS.map(([v,l]) => <Select.Option key={v} value={v} label={l} />)}
        </Select>
        <Button label="Reset" onClick={resetFilters} />
      </div>

      {error    && <Message appearance="error"   style={{ marginBottom: 8 }}>{error}</Message>}
      {loading  && !initialized && <WaitSpinner />}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          policies={policies}
          onAction={handleBulk}
          onClear={clearSelection}
        />
      )}

      <Table stripeRows>
        <Table.Head>
          <Table.HeadCell style={{ width: 32 }}>
            <Checkbox
              checked={allSelected}
              onChange={allSelected ? clearSelection : selectAll}
            />
          </Table.HeadCell>
          <Table.HeadCell>Type</Table.HeadCell>
          <Table.HeadCell>Value</Table.HeadCell>
          <Table.HeadCell>List</Table.HeadCell>
          <Table.HeadCell>Status</Table.HeadCell>
          <Table.HeadCell>Policy</Table.HeadCell>
          <Table.HeadCell>Expires</Table.HeadCell>
          <Table.HeadCell>Hits</Table.HeadCell>
          <Table.HeadCell>Source</Table.HeadCell>
          <Table.HeadCell>Actions</Table.HeadCell>
        </Table.Head>
        <Table.Body>
          {iocs.map(ioc => {
            const statusColor = STATUS_COLOR[ioc.status] || '#888';
            const isConflict  = ioc.conflict_state === 'conflict';
            return (
              <Table.Row key={ioc._key} style={isConflict ? { background: '#fff8e1' } : {}}>
                <Table.Cell>
                  <Checkbox checked={selected.has(ioc._key)} onChange={() => toggleSelect(ioc._key)} />
                </Table.Cell>
                <Table.Cell><Badge>{ioc.type}</Badge></Table.Cell>
                <Table.Cell style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isConflict && <span title="Conflict" style={{ marginRight: 4 }}>⚠️</span>}
                  {ioc.expiry_warning && <span title="Expiring soon" style={{ marginRight: 4 }}>🕐</span>}
                  {ioc.value}
                </Table.Cell>
                <Table.Cell>
                  <Badge appearance={ioc.list_type === 'block' ? 'destructive' : 'info'}>
                    {ioc.list_type}
                  </Badge>
                </Table.Cell>
                <Table.Cell><span style={{ color: statusColor, fontWeight: 600 }}>{ioc.status}</span></Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{(ioc.policy_names || []).join(', ') || '—'}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{ioc.stop_time ? ioc.stop_time.substring(0, 10) : '∞'}</Table.Cell>
                <Table.Cell>{ioc.hit_count || 0}</Table.Cell>
                <Table.Cell style={{ fontSize: 12 }}>{ioc.source || '—'}</Table.Cell>
                <Table.Cell>
                  <Button appearance="secondary" label="Edit"   onClick={() => openEdit(ioc)} style={{ marginRight: 4 }} />
                  <Button appearance="destructive" label="Del" onClick={() => setDelConfirm(ioc)} />
                </Table.Cell>
              </Table.Row>
            );
          })}
          {!loading && iocs.length === 0 && (
            <Table.Row>
              <Table.Cell colSpan={10} style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                No IOCs found. Add one above or adjust filters.
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>

      {totalPages > 1 && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Paginator current={page} total={totalPages} onChange={(_, { page: p }) => setPage(p)} />
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <Modal open onRequestClose={closeForm} style={{ width: 560 }}>
          <Modal.Header title={editTarget ? 'Edit IOC' : 'Add IOC'} onRequestClose={closeForm} />
          <Modal.Body>
            {formError && <Message appearance="error" style={{ marginBottom: 8 }}>{formError}</Message>}
            <IOCForm
              initialValues={editTarget}
              policies={policies}
              onSubmit={handleFormSubmit}
              onCancel={closeForm}
            />
          </Modal.Body>
        </Modal>
      )}

      {/* Delete confirm modal */}
      {delConfirm && (
        <Modal open onRequestClose={() => setDelConfirm(null)}>
          <Modal.Header title="Delete IOC" onRequestClose={() => setDelConfirm(null)} />
          <Modal.Body>
            <p>Delete <strong>{delConfirm.value}</strong> ({delConfirm.type} / {delConfirm.list_type})?</p>
            <p style={{ color: '#d41f1f' }}>This cannot be undone.</p>
          </Modal.Body>
          <Modal.Footer>
            <Button appearance="destructive" label="Delete" onClick={handleDelete} />
            <Button label="Cancel" onClick={() => setDelConfirm(null)} />
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
