'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// --- Simulation Engine ---
const RESOURCE_TYPES = ['TPM', 'RPM', 'Concurrent', 'Memory (MB)'];
const TOTAL_LIMITS: Record<string, number> = { TPM: 100000, RPM: 5000, Concurrent: 200, 'Memory (MB)': 4096 };

const JOB_TYPES = [
  {
    id: 'sales-bot',
    label: 'Sales Bot',
    baseRatio: 0.5,
    perJob: { TPM: 12000, RPM: 60, Concurrent: 8, 'Memory (MB)': 256 },
  },
  {
    id: 'support-bot',
    label: 'Support Bot',
    baseRatio: 0.3,
    perJob: { TPM: 4000, RPM: 30, Concurrent: 4, 'Memory (MB)': 128 },
  },
  {
    id: 'catalog-sync',
    label: 'Catalog Sync',
    baseRatio: 0.15,
    perJob: { TPM: 2000, RPM: 20, Concurrent: 2, 'Memory (MB)': 64 },
  },
  {
    id: 'analytics',
    label: 'Analytics',
    baseRatio: 0.05,
    perJob: { TPM: 800, RPM: 10, Concurrent: 1, 'Memory (MB)': 32 },
  },
];

const INSTANCES = ['instance-1', 'instance-2', 'instance-3'];
const COLORS: Record<string, string> = {
  'sales-bot': '#E85E3B',
  'support-bot': '#3B8EE8',
  'catalog-sync': '#5EBB6E',
  analytics: '#D4A843',
};
const INSTANCE_COLORS = ['#E8715A', '#5A9CE8', '#6EC97D'];

interface DataEntry {
  time: string;
  minute: number;
  [key: string]: string | number;
}

function generateTimeSeriesData(points = 60): DataEntry[] {
  const data: DataEntry[] = [];
  const phases = [
    { start: 0, end: 15, salesLoad: 0.3, supportLoad: 0.2, catalogLoad: 0.1, analyticsLoad: 0.05 },
    { start: 15, end: 30, salesLoad: 0.8, supportLoad: 0.3, catalogLoad: 0.1, analyticsLoad: 0.05 },
    { start: 30, end: 45, salesLoad: 0.4, supportLoad: 0.9, catalogLoad: 0.6, analyticsLoad: 0.1 },
    { start: 45, end: 60, salesLoad: 0.6, supportLoad: 0.5, catalogLoad: 0.2, analyticsLoad: 0.8 },
  ];

  for (let i = 0; i < points; i++) {
    const phase = phases.find((p) => i >= p.start && i < p.end) || phases[3];
    const noise = (): number => (Math.random() - 0.5) * 0.1;
    const loads: Record<string, number> = {
      'sales-bot': Math.max(0, Math.min(1, phase.salesLoad + noise())),
      'support-bot': Math.max(0, Math.min(1, phase.supportLoad + noise())),
      'catalog-sync': Math.max(0, Math.min(1, phase.catalogLoad + noise())),
      analytics: Math.max(0, Math.min(1, phase.analyticsLoad + noise())),
    };

    // Dynamic ratio rebalancing
    const totalDemand = Object.values(loads).reduce((s, v) => s + v, 0);
    const dynamicRatios: Record<string, number> = {};
    JOB_TYPES.forEach((jt) => {
      const demandWeight = loads[jt.id] / (totalDemand || 1);
      dynamicRatios[jt.id] = jt.baseRatio * 0.4 + demandWeight * 0.6;
    });
    const ratioSum = Object.values(dynamicRatios).reduce((s, v) => s + v, 0);
    JOB_TYPES.forEach((jt) => {
      dynamicRatios[jt.id] /= ratioSum;
    });

    const time = `${String(Math.floor(i / 2) + 10).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
    const entry: DataEntry = { time, minute: i };

    // Resource allocation per job type (for stacked area)
    RESOURCE_TYPES.forEach((res) => {
      JOB_TYPES.forEach((jt) => {
        entry[`${jt.id}_${res}_allocated`] = Math.round(TOTAL_LIMITS[res] * dynamicRatios[jt.id]);
        entry[`${jt.id}_${res}_used`] = Math.round(TOTAL_LIMITS[res] * dynamicRatios[jt.id] * loads[jt.id]);
      });
    });

    // Utilization %
    JOB_TYPES.forEach((jt) => {
      entry[`${jt.id}_utilization`] = Math.round(loads[jt.id] * 100);
      entry[`${jt.id}_ratio`] = Math.round(dynamicRatios[jt.id] * 100);
    });

    // Per-instance partition
    INSTANCES.forEach((inst) => {
      const instanceShare = 1 / INSTANCES.length;
      const jitter = 1 + (Math.random() - 0.5) * 0.1;
      entry[`${inst}_load`] = Math.round(
        JOB_TYPES.reduce((sum, jt) => sum + loads[jt.id] * dynamicRatios[jt.id], 0) *
          instanceShare *
          jitter *
          100
      );
    });

    data.push(entry);
  }
  return data;
}

// --- Components ---

const CustomTooltipStyle = {
  background: 'rgba(15, 15, 20, 0.95)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  padding: '10px 14px',
  fontSize: '12px',
  color: '#ccc',
  backdropFilter: 'blur(8px)',
};

function MetricCard({
  label,
  value,
  subtext,
  color,
  pulse,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
        padding: '16px 20px',
        minWidth: '140px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {pulse && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color || '#5EBB6E',
            animation: 'pulse 2s infinite',
          }}
        />
      )}
      <div
        style={{
          fontSize: '11px',
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '6px',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: color || '#eee',
          fontFamily: "'Space Grotesk', sans-serif",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {subtext && (
        <div
          style={{
            fontSize: '11px',
            color: '#555',
            marginTop: '4px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {subtext}
        </div>
      )}
    </div>
  );
}

function ResourceGauge({ resource, data }: { resource: string; data: DataEntry[] }) {
  const latest = data[data.length - 1];
  const total = TOTAL_LIMITS[resource];
  const used = JOB_TYPES.reduce((sum, jt) => sum + (Number(latest[`${jt.id}_${resource}_used`]) || 0), 0);
  const pct = Math.round((used / total) * 100);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '6px',
          fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <span style={{ color: '#999' }}>{resource}</span>
        <span style={{ color: pct > 80 ? '#E85E3B' : pct > 50 ? '#D4A843' : '#5EBB6E' }}>
          {used.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div
        style={{
          height: '6px',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '3px',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {JOB_TYPES.map((jt) => {
          const jobUsed = Number(latest[`${jt.id}_${resource}_used`]) || 0;
          const w = (jobUsed / total) * 100;
          return (
            <div
              key={jt.id}
              style={{ width: `${w}%`, background: COLORS[jt.id], transition: 'width 0.5s ease' }}
            />
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <h2
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#ddd',
          margin: 0,
          fontFamily: "'Space Grotesk', sans-serif",
          textTransform: 'uppercase',
          letterSpacing: '2px',
        }}
      >
        {children}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: '12px',
            color: '#555',
            margin: '4px 0 0',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// --- Main Dashboard ---

export function ResourceDashboard() {
  const [data, setData] = useState<DataEntry[]>(() => generateTimeSeriesData(60));
  const [selectedResource, setSelectedResource] = useState('TPM');
  const [isLive, setIsLive] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const addPoint = useCallback(() => {
    setData((prev) => {
      const newData = [...prev];
      const last = newData[newData.length - 1];
      const newMinute = last.minute + 1;
      const noise = (): number => (Math.random() - 0.5) * 0.15;
      const loads: Record<string, number> = {};
      JOB_TYPES.forEach((jt) => {
        const prevUtil = Number(last[`${jt.id}_utilization`]) / 100;
        loads[jt.id] = Math.max(0.02, Math.min(0.98, prevUtil + noise()));
      });
      const totalDemand = Object.values(loads).reduce((s, v) => s + v, 0);
      const dynamicRatios: Record<string, number> = {};
      JOB_TYPES.forEach((jt) => {
        const demandWeight = loads[jt.id] / (totalDemand || 1);
        dynamicRatios[jt.id] = jt.baseRatio * 0.4 + demandWeight * 0.6;
      });
      const ratioSum = Object.values(dynamicRatios).reduce((s, v) => s + v, 0);
      JOB_TYPES.forEach((jt) => {
        dynamicRatios[jt.id] /= ratioSum;
      });

      const hours = Math.floor(newMinute / 2) + 10;
      const entry: DataEntry = {
        time: `${String(hours % 24).padStart(2, '0')}:${newMinute % 2 === 0 ? '00' : '30'}`,
        minute: newMinute,
      };

      RESOURCE_TYPES.forEach((res) => {
        JOB_TYPES.forEach((jt) => {
          entry[`${jt.id}_${res}_allocated`] = Math.round(TOTAL_LIMITS[res] * dynamicRatios[jt.id]);
          entry[`${jt.id}_${res}_used`] = Math.round(TOTAL_LIMITS[res] * dynamicRatios[jt.id] * loads[jt.id]);
        });
      });
      JOB_TYPES.forEach((jt) => {
        entry[`${jt.id}_utilization`] = Math.round(loads[jt.id] * 100);
        entry[`${jt.id}_ratio`] = Math.round(dynamicRatios[jt.id] * 100);
      });
      INSTANCES.forEach((inst) => {
        const instanceShare = 1 / INSTANCES.length;
        const jitter = 1 + (Math.random() - 0.5) * 0.1;
        entry[`${inst}_load`] = Math.round(
          JOB_TYPES.reduce((sum, jt) => sum + loads[jt.id] * dynamicRatios[jt.id], 0) *
            instanceShare *
            jitter *
            100
        );
      });

      newData.push(entry);
      if (newData.length > 80) newData.shift();
      return newData;
    });
  }, []);

  useEffect(() => {
    if (isLive) {
      intervalRef.current = setInterval(addPoint, 1500);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, addPoint]);

  const latest = data[data.length - 1];
  const totalUsedTPM = JOB_TYPES.reduce((s, jt) => s + (Number(latest[`${jt.id}_TPM_used`]) || 0), 0);
  const totalUsedRPM = JOB_TYPES.reduce((s, jt) => s + (Number(latest[`${jt.id}_RPM_used`]) || 0), 0);
  const activeJobs = JOB_TYPES.reduce((s, jt) => s + (Number(latest[`${jt.id}_Concurrent_used`]) || 0), 0);

  const stackedAreaData = data.map((d) => {
    const entry: Record<string, string | number> = { time: d.time };
    JOB_TYPES.forEach((jt) => {
      entry[`${jt.id}_alloc`] = d[`${jt.id}_${selectedResource}_allocated`];
      entry[`${jt.id}_used`] = d[`${jt.id}_${selectedResource}_used`];
    });
    return entry;
  });

  return (
    <div
      style={{
        color: '#ccc',
        padding: '32px',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .resource-tab {
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.06);
          transition: all 0.2s;
          background: transparent;
          color: #666;
        }
        .resource-tab:hover { border-color: rgba(255,255,255,0.15); color: #999; }
        .resource-tab.active { background: rgba(255,255,255,0.08); color: #eee; border-color: rgba(255,255,255,0.15); }
        .live-btn {
          padding: 6px 16px;
          border-radius: 6px;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          border: 1px solid;
          transition: all 0.2s;
        }
        * { box-sizing: border-box; }
        .recharts-cartesian-grid-horizontal line, .recharts-cartesian-grid-vertical line {
          stroke: rgba(255,255,255,0.04) !important;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '32px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#eee',
              margin: 0,
              letterSpacing: '-0.5px',
            }}
          >
            Rate Limiter ∙ Job Queue
          </h1>
          <p
            style={{
              fontSize: '12px',
              color: '#444',
              margin: '6px 0 0',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Distributed resource orchestration — {INSTANCES.length} instances ∙ {JOB_TYPES.length} job types ∙{' '}
            {RESOURCE_TYPES.length} resource dimensions
          </p>
        </div>
        <button
          className="live-btn"
          onClick={() => setIsLive(!isLive)}
          style={{
            background: isLive ? 'rgba(232, 94, 59, 0.15)' : 'transparent',
            color: isLive ? '#E8715A' : '#666',
            borderColor: isLive ? 'rgba(232, 94, 59, 0.3)' : 'rgba(255,255,255,0.1)',
          }}
        >
          {isLive ? '● LIVE' : '○ PAUSED'}
        </button>
      </div>

      {/* Resource Gauges */}
      <div
        style={{
          background: 'rgb(18,18,22)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '20px 24px',
          marginBottom: '32px',
        }}
      >
        <SectionHeader subtitle="Current snapshot across all job types">Resource Utilization</SectionHeader>
        {RESOURCE_TYPES.map((r) => (
          <ResourceGauge key={r} resource={r} data={data} />
        ))}
        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
          {JOB_TYPES.map((jt) => (
            <div
              key={jt.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: '2px', background: COLORS[jt.id] }} />
              <span style={{ color: '#888' }}>{jt.label}</span>
              <span style={{ color: '#555' }}>({latest[`${jt.id}_ratio`]}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Stacked Area: Allocation over time */}
      <div
        style={{
          background: 'rgb(18,18,22)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '20px 24px',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <SectionHeader subtitle="Dynamic ratio rebalancing in action — watch allocations shift with demand">
            Resource Allocation Over Time
          </SectionHeader>
          <div style={{ display: 'flex', gap: '6px' }}>
            {RESOURCE_TYPES.map((r) => (
              <button
                key={r}
                className={`resource-tab ${selectedResource === r ? 'active' : ''}`}
                onClick={() => setSelectedResource(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={stackedAreaData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
              interval={5}
            />
            <YAxis
              tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
            />
            <Tooltip
              contentStyle={CustomTooltipStyle}
              labelStyle={{ color: '#eee', fontWeight: 600, marginBottom: '6px' }}
              formatter={(val, name) => {
                const jt = JOB_TYPES.find((j) => String(name).startsWith(j.id));
                const type = String(name).includes('alloc') ? 'Allocated' : 'Used';
                return [Number(val).toLocaleString(), `${jt?.label} ${type}`];
              }}
            />
            {JOB_TYPES.map((jt) => (
              <Area
                key={`${jt.id}_alloc`}
                type="monotone"
                dataKey={`${jt.id}_alloc`}
                stackId="alloc"
                fill={COLORS[jt.id]}
                fillOpacity={0.2}
                stroke={COLORS[jt.id]}
                strokeWidth={1.5}
                strokeOpacity={0.6}
              />
            ))}
            {JOB_TYPES.map((jt) => (
              <Area
                key={`${jt.id}_used`}
                type="monotone"
                dataKey={`${jt.id}_used`}
                stackId="used"
                fill={COLORS[jt.id]}
                fillOpacity={0.5}
                stroke={COLORS[jt.id]}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div
          style={{
            display: 'flex',
            gap: '24px',
            justifyContent: 'center',
            marginTop: '8px',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span style={{ color: '#666' }}>
            <span
              style={{
                display: 'inline-block',
                width: 20,
                height: 2,
                background: '#888',
                opacity: 0.4,
                verticalAlign: 'middle',
                marginRight: 6,
              }}
            />
            Allocated (faded)
          </span>
          <span style={{ color: '#666' }}>
            <span
              style={{
                display: 'inline-block',
                width: 20,
                height: 2,
                background: '#888',
                verticalAlign: 'middle',
                marginRight: 6,
              }}
            />
            Actual Usage (solid)
          </span>
        </div>
      </div>

      {/* Two-column: Utilization + Dynamic Ratios */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
        {/* Utilization % */}
        <div
          style={{
            background: 'rgb(18,18,22)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '14px',
            padding: '20px 24px',
          }}
        >
          <SectionHeader subtitle="% of allocated quota actually consumed">
            Job Type Utilization
          </SectionHeader>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                interval={9}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                labelStyle={{ color: '#eee', fontWeight: 600 }}
                formatter={(val) => [`${val}%`]}
              />
              {JOB_TYPES.map((jt) => (
                <Line
                  key={jt.id}
                  type="monotone"
                  dataKey={`${jt.id}_utilization`}
                  name={jt.label}
                  stroke={COLORS[jt.id]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Dynamic Ratios */}
        <div
          style={{
            background: 'rgb(18,18,22)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '14px',
            padding: '20px 24px',
          }}
        >
          <SectionHeader subtitle="How resource share shifts with demand pressure">
            Dynamic Ratio Rebalancing
          </SectionHeader>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                interval={9}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                labelStyle={{ color: '#eee', fontWeight: 600 }}
                formatter={(val) => [`${val}%`]}
              />
              {JOB_TYPES.map((jt) => (
                <Area
                  key={jt.id}
                  type="monotone"
                  dataKey={`${jt.id}_ratio`}
                  name={jt.label}
                  stackId="ratio"
                  fill={COLORS[jt.id]}
                  fillOpacity={0.6}
                  stroke={COLORS[jt.id]}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-Instance Load */}
      <div
        style={{
          background: 'rgb(18,18,22)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '20px 24px',
          marginBottom: '32px',
        }}
      >
        <SectionHeader subtitle="Even partition of total resource budget across distributed nodes">
          Per-Instance Load Distribution
        </SectionHeader>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
              interval={9}
            />
            <YAxis
              tick={{ fill: '#555', fontSize: 10, fontFamily: "'JetBrains Mono'" }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={CustomTooltipStyle}
              labelStyle={{ color: '#eee', fontWeight: 600 }}
              formatter={(val) => [`${val}%`]}
            />
            {INSTANCES.map((inst, i) => (
              <Line
                key={inst}
                type="monotone"
                dataKey={`${inst}_load`}
                name={inst}
                stroke={INSTANCE_COLORS[i]}
                strokeWidth={2}
                dot={false}
                strokeDasharray={i > 0 ? '5 3' : undefined}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Job Type Config Table */}
      <div
        style={{
          background: 'rgb(18,18,22)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '14px',
          padding: '20px 24px',
        }}
      >
        <SectionHeader subtitle="Base configuration before dynamic rebalancing">
          Job Type Configuration
        </SectionHeader>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 500 }}>
                  Job Type
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#666', fontWeight: 500 }}>
                  Base Ratio
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#666', fontWeight: 500 }}>
                  Current Ratio
                </th>
                {RESOURCE_TYPES.map((r) => (
                  <th
                    key={r}
                    style={{ textAlign: 'right', padding: '8px 12px', color: '#666', fontWeight: 500 }}
                  >
                    {r}/job
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#666', fontWeight: 500 }}>
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {JOB_TYPES.map((jt) => (
                <tr key={jt.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '2px', background: COLORS[jt.id] }} />
                    <span style={{ color: '#ccc' }}>{jt.label}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 12px', color: '#888' }}>
                    {Math.round(jt.baseRatio * 100)}%
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      padding: '10px 12px',
                      color: COLORS[jt.id],
                      fontWeight: 600,
                    }}
                  >
                    {latest[`${jt.id}_ratio`]}%
                  </td>
                  {RESOURCE_TYPES.map((r) => (
                    <td key={r} style={{ textAlign: 'right', padding: '10px 12px', color: '#888' }}>
                      {jt.perJob[r as keyof typeof jt.perJob].toLocaleString()}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        background:
                          Number(latest[`${jt.id}_utilization`]) > 75
                            ? 'rgba(232,94,59,0.15)'
                            : Number(latest[`${jt.id}_utilization`]) > 40
                              ? 'rgba(212,168,67,0.15)'
                              : 'rgba(94,187,110,0.15)',
                        color:
                          Number(latest[`${jt.id}_utilization`]) > 75
                            ? '#E8715A'
                            : Number(latest[`${jt.id}_utilization`]) > 40
                              ? '#D4A843'
                              : '#5EBB6E',
                      }}
                    >
                      {latest[`${jt.id}_utilization`]}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '32px',
          fontSize: '11px',
          color: '#333',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Distributed Rate Limiter — Dynamic Resource Allocation Visualization
      </div>
    </div>
  );
}
