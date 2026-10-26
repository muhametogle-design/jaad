import React from 'react';
import { Badge } from '../ui/Badge';
import { formatAge, hoursSince, agingStatus } from '../../lib/time';
import type { AgingStatus } from '../../types';

const META: Record<AgingStatus, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  fresh: { tone: 'green', label: 'FRESH' },
  aging: { tone: 'amber', label: 'AGING' },
  stale: { tone: 'red', label: 'STALE' },
};

interface Props {
  arrivedAt: string;
  now: number;
  freshHours: number;
  agingHours: number;
}

/** Live freshness timer badge: hours since flight landing. */
export function AgingBadge({ arrivedAt, now, freshHours, agingHours }: Props) {
  const hours = hoursSince(arrivedAt, now);
  const status = agingStatus(hours, { freshHours, agingHours });
  const meta = META[status];
  return <Badge label={`${meta.label} • ${formatAge(hours)} old`} tone={meta.tone} />;
}
