/**
 * components/AttackMap.jsx
 * D3 v7 world map showing geo-enriched IOC hit origins.
 * Uses /geo endpoint which returns { features: GeoJSON FeatureCollection }.
 * Falls back gracefully if D3 or geo data unavailable.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Message     from '@splunk/react-ui/Message';
import Select      from '@splunk/react-ui/Select';
import Button      from '@splunk/react-ui/Button';
import api         from '../api/api';

export default function AttackMap() {
  const svgRef  = useRef(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [geoData,  setGeoData]  = useState(null);
  const [d3,       setD3]       = useState(null);
  const [timeRange,setTimeRange]= useState('24h');
  const [listType, setListType] = useState('block');

  // Lazy-load D3 (it's a heavy dependency — only load when this tab is active)
  useEffect(() => {
    import('d3').then(mod => setD3(mod)).catch(() => setError('D3 library unavailable'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const res = await api.geo.get({ time_range: timeRange, list_type: listType });
    if (res.error) setError(res.error);
    else setGeoData(res.data);
    setLoading(false);
  }, [timeRange, listType]);

  useEffect(() => { load(); }, [load]);

  // Render D3 map whenever d3 or geoData changes
  useEffect(() => {
    if (!d3 || !geoData || !svgRef.current) return;

    const width  = svgRef.current.clientWidth || 900;
    const height = Math.round(width * 0.5);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const projection = d3.geoNaturalEarth1()
      .scale(width / 6.3)
      .translate([width / 2, height / 2]);

    const path = d3.geoPath().projection(projection);

    // World basemap — use TopoJSON countries if available
    const worldUrl = '/en-US/static/app/edl_manager/js/world-110m.json';
    fetch(worldUrl)
      .then(r => r.ok ? r.json() : null)
      .then(world => {
        if (world) {
          const topo = window.topojson;
          if (topo) {
            svg.append('g')
              .selectAll('path')
              .data(topo.feature(world, world.objects.countries).features)
              .join('path')
              .attr('d', path)
              .attr('fill', '#e8e8e8')
              .attr('stroke', '#ccc')
              .attr('stroke-width', 0.4);
          }
        }

        // Plot hit circles
        const hits = (geoData.hits || []).filter(h => h.lat && h.lon);
        const maxHits = d3.max(hits, h => h.count) || 1;
        const rScale  = d3.scaleSqrt().domain([1, maxHits]).range([3, 20]);
        const color   = listType === 'block' ? '#d41f1f' : '#2196f3';

        svg.append('g')
          .selectAll('circle')
          .data(hits)
          .join('circle')
          .attr('cx', h => projection([h.lon, h.lat])?.[0])
          .attr('cy', h => projection([h.lon, h.lat])?.[1])
          .attr('r',  h => rScale(h.count || 1))
          .attr('fill', color)
          .attr('fill-opacity', 0.55)
          .attr('stroke', color)
          .attr('stroke-width', 0.8)
          .append('title')
          .text(h => `${h.country || h.city || 'Unknown'}: ${h.count} hit(s)`);
      })
      .catch(() => {
        // No basemap — just plot circles on blank canvas
        svg.append('rect').attr('width', width).attr('height', height).attr('fill', '#f0f0f0');
        const hits = (geoData.hits || []);
        if (hits.length === 0) {
          svg.append('text').attr('x', width / 2).attr('y', height / 2)
            .attr('text-anchor', 'middle').attr('fill', '#999').text('No geo data available');
        }
      });
  }, [d3, geoData, listType]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Attack Map</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select value={timeRange} onChange={(_, { value }) => setTimeRange(value)} style={{ width: 120 }}>
            <Select.Option value="1h"  label="Last 1h" />
            <Select.Option value="24h" label="Last 24h" />
            <Select.Option value="7d"  label="Last 7d" />
            <Select.Option value="30d" label="Last 30d" />
          </Select>
          <Select value={listType} onChange={(_, { value }) => setListType(value)} style={{ width: 110 }}>
            <Select.Option value="block" label="Block hits" />
            <Select.Option value="allow" label="Allow hits" />
          </Select>
          <Button label="Refresh" onClick={load} />
        </div>
      </div>

      {error   && <Message appearance="warning" style={{ marginBottom: 8 }}>{error}</Message>}
      {loading && <div style={{ textAlign: 'center', padding: 40 }}><WaitSpinner size="large" /></div>}

      {!loading && (
        <>
          <svg
            ref={svgRef}
            style={{ width: '100%', height: 'auto', minHeight: 400, background: '#fafafa', border: '1px solid #ddd', borderRadius: 4 }}
          />
          {geoData && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              {(geoData.hits || []).length} unique origin{(geoData.hits || []).length !== 1 ? 's' : ''} ·
              {' '}{geoData.total_hits || 0} total hits · {timeRange} window
            </p>
          )}
        </>
      )}
    </div>
  );
}
