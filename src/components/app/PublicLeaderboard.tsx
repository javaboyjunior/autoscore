import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useCollection } from '@/lib/api';
import { format, parseISO } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

type Event  = { id: string; name: string; date: string; isCurrent?: boolean; scoringLocked?: boolean };
type Car    = { id: string; registrationId: number; ownerInfo: string; make: string; model: string; year: number };
type Judge  = { id: string };
type Score  = { id: string; carId: string; judgeId: string; score: number | null };
type RankedCar = Car & { rank: number; totalScore: number; isComplete: boolean };

const MEDALS = ['🥇', '🥈', '🥉'];

export default function PublicLeaderboard() {
  const { eventId: paramEventId } = useParams<{ eventId?: string }>();
  const [selectedEventId, setSelectedEventId] = useState(paramEventId || '');
  const [showPartial, setShowPartial] = useState(true);

  const { data: events } = useCollection<Event>('/api/events', { watchTables: ['events'] });

  // Auto-select current event if no param given
  useEffect(() => {
    if (paramEventId) { setSelectedEventId(paramEventId); return; }
    if (!events) return;
    const current = events.find((e) => e.isCurrent);
    if (current) { setSelectedEventId(current.id); return; }
    const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
    if (sorted.length) setSelectedEventId(sorted[0].id);
  }, [events, paramEventId]);

  const { data: cars   } = useCollection<Car>(selectedEventId   ? `/api/cars?eventId=${selectedEventId}`    : null, { watchTables: ['cars'],   watchEventId: selectedEventId });
  const { data: judges } = useCollection<Judge>(selectedEventId ? `/api/judges?eventId=${selectedEventId}`  : null, { watchTables: ['judges'], watchEventId: selectedEventId });
  const { data: scores } = useCollection<Score>(selectedEventId ? `/api/scores?eventId=${selectedEventId}`  : null, { watchTables: ['scores'], watchEventId: selectedEventId });

  const selectedEvent = events?.find((e) => e.id === selectedEventId);

  const ranked: RankedCar[] = useMemo(() => {
    const totalJudges = judges?.length || 0;
    if (!cars || totalJudges === 0) return [];

    const eligible = cars
      .map((car) => {
        const carScores = scores?.filter((s) => s.carId === car.id && s.score !== null) || [];
        const scoredJudges = new Set(carScores.map((s) => s.judgeId)).size;
        if (scoredJudges === 0) return null;
        const isComplete = scoredJudges === totalJudges;
        if (!showPartial && !isComplete) return null;
        return { ...car, totalScore: carScores.reduce((acc, s) => acc + (s.score || 0), 0), isComplete };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.totalScore - a.totalScore);

    let rank = 1;
    return eligible.map((car, i) => {
      if (i > 0 && eligible[i - 1].totalScore > car.totalScore) rank = i + 1;
      return { ...car, rank };
    });
  }, [cars, judges, scores, showPartial]);

  const isLocked = selectedEvent?.scoringLocked ?? false;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#09090b',
      color: '#fafafa',
      fontFamily: 'system-ui, sans-serif',
      padding: '2rem 1.5rem',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: isLocked ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
          border: `1px solid ${isLocked ? 'rgba(34,197,94,0.4)' : 'rgba(234,179,8,0.4)'}`,
          borderRadius: '9999px',
          padding: '0.3rem 1rem',
          fontSize: '0.78rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: isLocked ? '#86efac' : '#fde047',
          marginBottom: '1rem',
        }}>
          {isLocked ? '🏁 Final Results' : '⏱ Scoring in Progress'}
        </div>

        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 800, margin: 0 }}>
          {selectedEvent?.name || 'Leaderboard'}
        </h1>
        {selectedEvent?.date && (
          <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: '0.35rem', fontSize: '0.9rem' }}>
            {format(parseISO(selectedEvent.date), 'MMMM d, yyyy')}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <Switch id="show-partial" checked={showPartial} onCheckedChange={setShowPartial} />
          <Label htmlFor="show-partial" style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', cursor: 'pointer' }}>
            Show partial scores
          </Label>
        </div>
      </div>

      {/* Table */}
      {ranked.length > 0 ? (
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          {ranked.map((car, i) => (
            <div key={car.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem 1.5rem',
              marginBottom: '0.6rem',
              borderRadius: '0.75rem',
              background: i === 0 && car.isComplete ? 'rgba(234,179,8,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${i === 0 && car.isComplete ? 'rgba(234,179,8,0.25)' : 'rgba(255,255,255,0.07)'}`,
              opacity: car.isComplete ? 1 : 0.5,
            }}>
              {/* Rank */}
              <div style={{
                width: '3rem',
                textAlign: 'center',
                fontSize: i < 3 ? '1.8rem' : '1.4rem',
                fontWeight: 800,
                color: i < 3 ? undefined : 'rgba(255,255,255,0.3)',
                flexShrink: 0,
              }}>
                {i < 3 ? MEDALS[i] : car.rank}
              </div>

              {/* Car info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 'clamp(1rem, 2vw, 1.2rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {car.year} {car.make} {car.model}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem', marginTop: '0.1rem' }}>
                  {car.ownerInfo} &nbsp;·&nbsp; #{car.registrationId}
                </div>
              </div>

              {/* Score */}
              <div style={{
                fontWeight: 800,
                fontSize: 'clamp(1.2rem, 2.5vw, 1.6rem)',
                color: i === 0 ? '#fde047' : 'rgba(255,255,255,0.85)',
                flexShrink: 0,
              }}>
                {car.totalScore.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'rgba(255,255,255,0.3)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏎️</div>
          <p>No fully scored cars yet.</p>
        </div>
      )}

      {/* Footer */}
      <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', marginTop: '3rem' }}>
        AutoScore Live — updates automatically
      </p>
    </div>
  );
}
