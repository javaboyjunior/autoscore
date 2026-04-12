import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useCollection } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Trophy } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';

type Event = { id: string; name: string; date: string; isCurrent?: boolean };
type Car = { id: string; eventId: string; registrationId: number; ownerInfo: string; make: string; model: string; year: number; color: string };
type Judge = { id: string; eventId: string; name: string; email: string };
type Score = { id: string; carId: string; judgeId: string; eventId: string; score: number | null; notes: string };
type LeaderboardCar = Car & { rank: number; totalScore: number; scoredCount: number; isComplete: boolean };

export default function Leaderboard() {
  const [searchParams] = useSearchParams();
  const [selectedEventId, setSelectedEventId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data: events, isLoading: isLoadingEvents } = useCollection<Event>(
    '/api/events',
    { watchTables: ['events'] },
  );

  const sortedEvents = useMemo(
    () => (events ? [...events].sort((a, b) => b.date.localeCompare(a.date)) : []),
    [events],
  );

  useEffect(() => {
    const fromUrl = searchParams.get('eventId');
    if (fromUrl) { setSelectedEventId(fromUrl); return; }
    if (!events) return;
    const current = events.find((e) => e.isCurrent);
    if (current) { setSelectedEventId(current.id); return; }
    if (sortedEvents.length > 0) setSelectedEventId(sortedEvents[0].id);
  }, [events, searchParams, sortedEvents]);

  const { data: eventCars, isLoading: isLoadingCars } = useCollection<Car>(
    selectedEventId ? `/api/cars?eventId=${selectedEventId}` : null,
    { watchTables: ['cars'], watchEventId: selectedEventId },
  );

  const { data: eventJudges, isLoading: isLoadingJudges } = useCollection<Judge>(
    selectedEventId ? `/api/judges?eventId=${selectedEventId}` : null,
    { watchTables: ['judges'], watchEventId: selectedEventId },
  );

  const { data: eventScores, isLoading: isLoadingScores } = useCollection<Score>(
    selectedEventId ? `/api/scores?eventId=${selectedEventId}` : null,
    { watchTables: ['scores'], watchEventId: selectedEventId },
  );

  const leaderboardData: LeaderboardCar[] = useMemo(() => {
    const totalJudges = eventJudges?.length || 0;
    if (!eventCars || totalJudges === 0) return [];

    const scored = eventCars
      .map((car) => {
        const carScores = eventScores?.filter((s) => s.carId === car.id && s.score !== null) || [];
        const scoredCount = new Set(carScores.map((s) => s.judgeId)).size;
        const isComplete = scoredCount === totalJudges;
        if (!showAll && !isComplete) return null;
        if (scoredCount === 0) return null; // never show unseen cars
        return { ...car, totalScore: carScores.reduce((acc, s) => acc + (s.score || 0), 0), scoredCount, isComplete };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.totalScore - a.totalScore);

    let rank = 1;
    return scored.map((car, i) => {
      if (i > 0 && scored[i - 1].totalScore > car.totalScore) rank = i + 1;
      return { ...car, rank };
    });
  }, [eventCars, eventJudges, eventScores, showAll]);

  const isLoading = isLoadingEvents || isLoadingCars || isLoadingJudges || isLoadingScores;
  const selectedEvent = events?.find((e) => e.id === selectedEventId);

  const handleExportToCSV = () => {
    setIsExporting(true);
    const headers = ['Rank', 'Registration ID', 'Owner', 'Make', 'Model', 'Year', 'Total Score'];
    const rows = leaderboardData.map((car) =>
      [car.rank, car.registrationId, car.ownerInfo, car.make, car.model, car.year, car.totalScore.toFixed(1)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`),
    );
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${(selectedEvent?.name || 'export').replace(/\s/g, '_')}_leaderboard.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExporting(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
        <h1 className="text-xl font-bold font-headline text-primary">
          <Link to="/admin">AutoScore Live Admin</Link>
        </h1>
        <div className="ml-auto flex items-center gap-4">
          {events && events.length > 0 && (
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger className="w-[250px]"><SelectValue placeholder="Select an event" /></SelectTrigger>
              <SelectContent>
                {sortedEvents.map((ev) => <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <main className="p-4 md:p-6">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-y-1.5 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-6 w-6 text-accent" />
                    <CardTitle className="text-2xl">Leaderboard</CardTitle>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
                      <Label htmlFor="show-all" className="text-sm text-muted-foreground cursor-pointer">Show partial</Label>
                    </div>
                    <Button onClick={handleExportToCSV} variant="outline" disabled={isExporting}>
                      {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                      Export to CSV
                    </Button>
                  </div>
                </div>
                {selectedEvent && (
                  <CardDescription>
                    Showing results for {selectedEvent.name} on {format(parseISO(selectedEvent.date), 'PPP')}
                  </CardDescription>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {leaderboardData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px] text-center">Rank</TableHead>
                      <TableHead>Reg. ID</TableHead><TableHead>Year</TableHead>
                      <TableHead>Car</TableHead><TableHead>Owner</TableHead>
                      <TableHead className="text-right">Total Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboardData.map((car) => (
                      <TableRow key={car.id} className={!car.isComplete ? 'opacity-60' : ''}>
                        <TableCell className="text-center font-bold text-lg">
                          {car.isComplete ? car.rank : '–'}
                        </TableCell>
                        <TableCell>{car.registrationId}</TableCell>
                        <TableCell>{car.year}</TableCell>
                        <TableCell>{car.make} {car.model}</TableCell>
                        <TableCell>{car.ownerInfo}</TableCell>
                        <TableCell className="text-right font-medium">
                          {car.totalScore.toFixed(1)}
                          {!car.isComplete && (
                            <Badge variant="secondary" className="ml-2 text-xs">{car.scoredCount}/{eventJudges?.length}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-16 border-2 border-dashed rounded-lg">
                  <h3 className="text-xl font-semibold text-muted-foreground">Not Enough Data</h3>
                  <p className="text-muted-foreground mt-2">There are no fully scored cars to display yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
