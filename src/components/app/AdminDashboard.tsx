import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useCollection, api } from '@/lib/api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  PlusCircle, Edit, Users, Car as CarIcon, ListChecks, CheckCircle2,
  XCircle, Calendar, Star, Loader2, Trophy, Download, Upload, LogOut, Lock, LockOpen,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

type Event = { id: string; name: string; date: string; isCurrent?: boolean; scoringLocked?: boolean };
type Car = {
  id: string; eventId: string; registrationId: number; ownerInfo: string;
  make: string; model: string; year: number; color: string;
};
type Judge = { id: string; eventId: string; name: string; email: string; password?: string };
type Score = { id: string; carId: string; judgeId: string; eventId: string; score: number | null; notes: string };
type CarScoringDetails = Car & {
  totalJudges: number; scoredJudges: number; isFullyScored: boolean;
  totalScore: number | null; maxScore: number;
};

// Handles quoted fields and escaped quotes ("") per RFC 4180
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export default function AdminDashboard({ onLogout }: { onLogout?: () => void }) {
  const [searchParams] = useSearchParams();
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [carToEdit, setCarToEdit] = useState<Car | null>(null);
  const [judgeToEdit, setJudgeToEdit] = useState<Judge | null>(null);
  const [isCarDialogOpen, setCarDialogOpen] = useState(false);
  const [isJudgeDialogOpen, setJudgeDialogOpen] = useState(false);
  const [isEventDialogOpen, setEventDialogOpen] = useState(false);
  const [isScoreDetailOpen, setScoreDetailOpen] = useState(false);
  const [selectedCarForDetails, setSelectedCarForDetails] = useState<CarScoringDetails | null>(null);
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [carSearchQuery, setCarSearchQuery] = useState('');
  const { toast } = useToast();

  // ── Data fetching (replaces Firebase onSnapshot) ─────────────────────────
  const { data: events, isLoading: isLoadingEvents } = useCollection<Event>(
    '/api/events',
    { watchTables: ['events'] },
  );

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

  // ── Auto-select event ─────────────────────────────────────────────────────
  useEffect(() => {
    const fromUrl = searchParams.get('eventId');
    if (fromUrl) { setSelectedEventId(fromUrl); return; }
    if (!events) return;
    const current = events.find((e) => e.isCurrent);
    if (current) { setSelectedEventId(current.id); return; }
    if (events.length > 0) {
      const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
      setSelectedEventId(sorted[0].id);
    }
  }, [events, searchParams]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const sortedEvents = useMemo(
    () => (events ? [...events].sort((a, b) => b.date.localeCompare(a.date)) : []),
    [events],
  );

  const filteredEventCars = useMemo(() => {
    if (!eventCars) return [];
    let cars = [...eventCars].sort((a, b) => a.registrationId - b.registrationId);
    if (carSearchQuery) {
      const q = carSearchQuery.toLowerCase();
      cars = cars.filter((c) =>
        String(c.registrationId).includes(q) || c.make.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) || String(c.year).includes(q) ||
        c.ownerInfo.toLowerCase().includes(q) || c.color.toLowerCase().includes(q),
      );
    }
    return cars;
  }, [eventCars, carSearchQuery]);

  const scoringStatus: CarScoringDetails[] = useMemo(() => {
    const totalJudges = eventJudges?.length || 0;
    if (!eventCars) return [];
    return eventCars.map((car) => {
      const carScores = eventScores?.filter((s) => s.carId === car.id && s.score !== null) || [];
      const scoredJudges = new Set(carScores.map((s) => s.judgeId)).size;
      const isFullyScored = totalJudges > 0 && scoredJudges === totalJudges;
      const totalScore = carScores.length > 0 ? carScores.reduce((acc, s) => acc + (s.score || 0), 0) : null;
      return { ...car, totalJudges, scoredJudges, isFullyScored, totalScore, maxScore: totalJudges * 10 };
    });
  }, [eventCars, eventJudges, eventScores]);

  const filteredScoringStatus = useMemo(
    () => showIncompleteOnly ? scoringStatus.filter((s) => !s.isFullyScored) : scoringStatus,
    [showIncompleteOnly, scoringStatus],
  );

  const selectedCarJudgeScores = useMemo(() => {
    if (!selectedCarForDetails || !eventJudges) return [];
    return eventJudges.map((judge) => {
      const score = eventScores?.find((s) => s.judgeId === judge.id && s.carId === selectedCarForDetails.id);
      return { judgeName: judge.name, score: score?.score, notes: score?.notes };
    });
  }, [selectedCarForDetails, eventJudges, eventScores]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleEventSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    api.post('/api/events', {
      name: fd.get('name'),
      date: fd.get('date'),
      isCurrent: !events?.length,
    });
    toast({ title: 'Event Added', description: `${fd.get('name')} has been created.` });
    setEventDialogOpen(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    const ev = events?.find((e) => e.id === eventId);
    if (!ev) return;
    try {
      await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
      toast({ title: 'Event Deleted', description: `${ev.name} and all its data have been removed.` });
      if (selectedEventId === eventId) {
        const next = events?.find((e) => e.id !== eventId);
        setSelectedEventId(next?.id || '');
      }
    } catch {
      toast({ variant: 'destructive', title: 'Deletion Failed', description: 'Could not delete the event.' });
    }
  };

  const handleSetCurrentEvent = async (eventId: string) => {
    try {
      await fetch(`/api/events/${eventId}/set-current`, { method: 'PUT' });
      toast({
        title: 'Current Event Set',
        description: `${events?.find((e) => e.id === eventId)?.name} is now the current event.`,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not set the current event.' });
    }
  };

  const handleToggleLock = async (eventId: string, currentlyLocked: boolean) => {
    try {
      await fetch(`/api/events/${eventId}/lock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !currentlyLocked }),
      });
      toast({
        title: currentlyLocked ? 'Scoring Unlocked' : 'Scoring Locked',
        description: currentlyLocked ? 'Judges can submit scores again.' : 'No more scores can be submitted.',
      });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not change lock state.' });
    }
  };

  const handleCarSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const registrationId = Number(fd.get('registrationId'));

    const isDuplicate = eventCars?.some((car) =>
      String(car.registrationId) === String(registrationId) && (!carToEdit || car.id !== carToEdit.id),
    );
    if (isDuplicate) {
      toast({ variant: 'destructive', title: 'Duplicate Registration ID', description: `Reg ID ${registrationId} is already in use.` });
      return;
    }

    const carData = {
      registrationId, ownerInfo: fd.get('ownerInfo'), make: fd.get('make'),
      model: fd.get('model'), year: Number(fd.get('year')), color: fd.get('color'),
      eventId: selectedEventId,
    };

    if (carToEdit) {
      api.put(`/api/cars/${carToEdit.id}`, carData);
      toast({ title: 'Car Updated', description: `${carData.make} ${carData.model} has been updated.` });
    } else {
      api.post('/api/cars', carData);
      toast({ title: 'Car Added', description: `${carData.make} ${carData.model} has been added.` });
    }
    setCarDialogOpen(false);
    setCarToEdit(null);
  };

  const handleJudgeSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name') as string;
    const email = fd.get('email') as string;
    const password = fd.get('password') as string;

    if (judgeToEdit) {
      const data: Record<string, string> = { name, email };
      if (password) data.password = password;
      api.put(`/api/judges/${judgeToEdit.id}`, data);
      toast({ title: 'Judge Updated', description: `${name} has been updated.` });
    } else {
      api.post('/api/judges', { name, email, password, eventId: selectedEventId });
      toast({ title: 'Judge Added', description: `${name} has been added.` });
    }
    setJudgeDialogOpen(false);
    setJudgeToEdit(null);
  };

  const importInputRef = useRef<HTMLInputElement>(null);

  // ── Cars-only CSV export (no scores — for moving cars between events) ─────
  const handleExportCarsCSV = () => {
    if (!eventCars?.length) return;
    const headers = ['Reg ID', 'Owner Info', 'Make', 'Model', 'Year', 'Color'];
    const rows = eventCars
      .slice()
      .sort((a, b) => a.registrationId - b.registrationId)
      .map((car) =>
        [car.registrationId, car.ownerInfo, car.make, car.model, car.year, car.color]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      );
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const name = events?.find((e) => e.id === selectedEventId)?.name || 'cars';
    link.setAttribute('download', `${name.replace(/\s+/g, '_')}_cars.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Cars CSV import ───────────────────────────────────────────────────────
  const handleImportCarsCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-selected
    if (!file || !selectedEventId) return;

    const text = await file.text();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast({ variant: 'destructive', title: 'Import Failed', description: 'CSV must have a header row and at least one data row.' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const line of lines.slice(1)) {
      const [regStr, ownerInfo, make, model, yearStr, color] = parseCSVLine(line);
      const registrationId = parseInt(regStr, 10);
      if (isNaN(registrationId) || !make?.trim() || !model?.trim()) { skipped++; continue; }

      const result = await api.postAwait('/api/cars', {
        eventId: selectedEventId,
        registrationId,
        ownerInfo: ownerInfo ?? '',
        make: make.trim(),
        model: model.trim(),
        year: parseInt(yearStr, 10) || 0,
        color: color ?? '',
      });

      if (result?.error) {
        errors.push(`Reg ${registrationId}: ${result.error}`);
        skipped++;
      } else {
        imported++;
      }
    }

    if (errors.length) {
      toast({
        variant: 'destructive',
        title: `Import completed with errors`,
        description: `${imported} imported, ${skipped} skipped. ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`,
      });
    } else {
      toast({
        title: 'Import Successful',
        description: `${imported} car${imported !== 1 ? 's' : ''} imported${skipped ? `, ${skipped} skipped` : ''}.`,
      });
    }
  };

  const handleExportToCSV = () => {
    if (!eventCars || !eventJudges) return;
    const sortedJudges = [...eventJudges].sort((a, b) => a.name.localeCompare(b.name));
    const headers = ['Reg ID', 'Owner', 'Make', 'Model', 'Year', 'Color', 'Total Score',
      ...sortedJudges.map((j) => `Judge: ${j.name}`)];
    const rows = eventCars.map((car) => {
      const carScores = eventScores?.filter((s) => s.carId === car.id) || [];
      const total = carScores.reduce((acc, s) => acc + (s.score || 0), 0);
      const judgeScores = sortedJudges.map((j) =>
        carScores.find((s) => s.judgeId === j.id)?.score?.toFixed(1) ?? 'N/A');
      return [car.registrationId, car.ownerInfo, car.make, car.model, car.year, car.color,
        total > 0 ? total.toFixed(1) : 'N/A', ...judgeScores]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`);
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${(events?.find((e) => e.id === selectedEventId)?.name || 'export').replace(/\s/g, '_')}_scoring.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isLoading = isLoadingEvents || isLoadingCars || isLoadingJudges || isLoadingScores;
  const currentTab = searchParams.get('tab') || 'overview';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
        <h1 className="text-xl font-bold font-headline text-primary">
          <Link to="/">AutoScore Live</Link>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {events && events.length > 0 && (
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger className="w-[250px]"><SelectValue placeholder="Select an event" /></SelectTrigger>
              <SelectContent>
                {sortedEvents.map((ev) => <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {onLogout && (
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
              <LogOut className="h-4 w-4 mr-1" />Sign out
            </Button>
          )}
        </div>
      </header>

      <main className="p-4 md:p-6">
        {isLoading && (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && events && events.length > 0 ? (
          <Tabs value={currentTab} className="no-print">
            <TabsList className="grid w-full grid-cols-5 mb-6">
              <TabsTrigger value="overview" asChild>
                <Link to={`/admin?tab=overview&eventId=${selectedEventId}`}><ListChecks className="mr-2 h-4 w-4" />Overview</Link>
              </TabsTrigger>
              <TabsTrigger value="cars" asChild>
                <Link to={`/admin?tab=cars&eventId=${selectedEventId}`}><CarIcon className="mr-2 h-4 w-4" />Cars</Link>
              </TabsTrigger>
              <TabsTrigger value="judges" asChild>
                <Link to={`/admin?tab=judges&eventId=${selectedEventId}`}><Users className="mr-2 h-4 w-4" />Judges</Link>
              </TabsTrigger>
              <TabsTrigger value="leaderboard" asChild>
                <Link to={`/admin/leaderboard?eventId=${selectedEventId}`}><Trophy className="mr-2 h-4 w-4" />Leaderboard</Link>
              </TabsTrigger>
              <TabsTrigger value="events" asChild>
                <Link to={`/admin?tab=events&eventId=${selectedEventId}`}><Calendar className="mr-2 h-4 w-4" />Events</Link>
              </TabsTrigger>
            </TabsList>

            {/* ── Overview ── */}
            <TabsContent value="overview">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle>Scoring Overview</CardTitle>
                      <CardDescription>Monitor the real-time scoring progress. Click a row to see details.</CardDescription>
                    </div>
                    <Button onClick={handleExportToCSV} variant="outline"><Download className="mr-2 h-4 w-4" />Export to CSV</Button>
                  </div>
                  <div className="flex items-center space-x-2 pt-4">
                    <Switch id="show-incomplete" checked={showIncompleteOnly} onCheckedChange={setShowIncompleteOnly} />
                    <Label htmlFor="show-incomplete">Show only uncompleted cars</Label>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Car</TableHead><TableHead>Owner</TableHead>
                        <TableHead className="text-center">Progress</TableHead>
                        <TableHead className="text-center">Total Score</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredScoringStatus.map((car) => (
                        <TableRow key={car.id} onClick={() => { setSelectedCarForDetails(car); setScoreDetailOpen(true); }} className="cursor-pointer">
                          <TableCell>{car.make} {car.model} ({car.year})</TableCell>
                          <TableCell>{car.ownerInfo}</TableCell>
                          <TableCell className="text-center">{car.scoredJudges} / {car.totalJudges} Scored</TableCell>
                          <TableCell className="text-center font-medium">
                            {car.totalScore !== null ? `${car.totalScore.toFixed(1)} / ${car.maxScore.toFixed(1)}` : 'N/A'}
                          </TableCell>
                          <TableCell className="text-center">
                            {car.isFullyScored
                              ? <Badge variant="default" className="bg-green-500"><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge>
                              : <Badge variant="secondary"><XCircle className="mr-1 h-3 w-3" />Pending</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Events ── */}
            <TabsContent value="events">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div><CardTitle>Event Management</CardTitle><CardDescription>Add, delete, and set the current event.</CardDescription></div>
                    <Dialog open={isEventDialogOpen} onOpenChange={setEventDialogOpen}>
                      <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Add Event</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Add New Event</DialogTitle></DialogHeader>
                        <form onSubmit={handleEventSubmit} className="grid gap-4 py-4">
                          <Input name="name" placeholder="Event Name" required />
                          <Input name="date" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} required />
                          <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                            <Button type="submit">Add Event</Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event Name</TableHead><TableHead>Date</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedEvents.map((ev) => (
                        <TableRow key={ev.id}>
                          <TableCell>{ev.name}</TableCell>
                          <TableCell>{format(parseISO(ev.date), 'PPP')}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              {ev.isCurrent && <Badge><Star className="mr-1 h-3 w-3" />Current</Badge>}
                              {ev.scoringLocked && <Badge variant="destructive"><Lock className="mr-1 h-3 w-3" />Locked</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              variant={ev.isCurrent ? 'secondary' : 'outline'}
                              size="sm"
                              onClick={() => handleSetCurrentEvent(ev.id)}
                              disabled={ev.isCurrent}
                            >
                              Set as Current
                            </Button>
                            <Button
                              variant={ev.scoringLocked ? 'outline' : 'secondary'}
                              size="sm"
                              onClick={() => handleToggleLock(ev.id, !!ev.scoringLocked)}
                            >
                              {ev.scoringLocked
                                ? <><LockOpen className="mr-1 h-3 w-3" />Unlock</>
                                : <><Lock className="mr-1 h-3 w-3" />Lock Scoring</>}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive">Delete</Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>This cannot be undone. All event data will be lost.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteEvent(ev.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Cars ── */}
            <TabsContent value="cars">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div><CardTitle>Car Management</CardTitle><CardDescription>Add, edit, or remove cars for this event.</CardDescription></div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <div className="w-full max-w-xs">
                        <Input placeholder="Search cars..." value={carSearchQuery} onChange={(e) => setCarSearchQuery(e.target.value)} />
                      </div>
                      <Button variant="outline" size="sm" onClick={handleExportCarsCSV} disabled={!selectedEventId || !eventCars?.length}>
                        <Download className="mr-2 h-4 w-4" />Export CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} disabled={!selectedEventId}>
                        <Upload className="mr-2 h-4 w-4" />Import CSV
                      </Button>
                      <input ref={importInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCarsCSV} />
                      <Dialog open={isCarDialogOpen} onOpenChange={(o) => { setCarDialogOpen(o); if (!o) setCarToEdit(null); }}>
                        <DialogTrigger asChild>
                          <Button disabled={!selectedEventId}><PlusCircle className="mr-2 h-4 w-4" /> Add Car</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>{carToEdit ? 'Edit Car' : 'Add New Car'}</DialogTitle></DialogHeader>
                          <form onSubmit={handleCarSubmit} className="grid gap-4 py-4">
                            <Input name="registrationId" placeholder="Registration ID" type="number" defaultValue={carToEdit?.registrationId} required />
                            <Input name="ownerInfo" placeholder="Owner Information" defaultValue={carToEdit?.ownerInfo} required />
                            <Input name="year" placeholder="Year" type="number" defaultValue={carToEdit?.year} required />
                            <Input name="make" placeholder="Make" defaultValue={carToEdit?.make} required />
                            <Input name="model" placeholder="Model" defaultValue={carToEdit?.model} required />
                            <Input name="color" placeholder="Color" defaultValue={carToEdit?.color} required />
                            <DialogFooter>
                              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                              <Button type="submit">{carToEdit ? 'Save Changes' : 'Add Car'}</Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reg. ID</TableHead><TableHead>Year</TableHead><TableHead>Make & Model</TableHead>
                        <TableHead>Color</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEventCars.map((car) => (
                        <TableRow key={car.id}>
                          <TableCell>{car.registrationId}</TableCell>
                          <TableCell>{car.year}</TableCell>
                          <TableCell>{car.make} {car.model}</TableCell>
                          <TableCell>{car.color}</TableCell>
                          <TableCell>{car.ownerInfo}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => { setCarToEdit(car); setCarDialogOpen(true); }}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive"
                              onClick={() => api.delete(`/api/cars/${car.id}`)}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Judges ── */}
            <TabsContent value="judges">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div><CardTitle>Judge Management</CardTitle><CardDescription>Add, edit, or remove judges for this event.</CardDescription></div>
                    <Dialog open={isJudgeDialogOpen} onOpenChange={(o) => { setJudgeDialogOpen(o); if (!o) setJudgeToEdit(null); }}>
                      <DialogTrigger asChild>
                        <Button disabled={!selectedEventId}><PlusCircle className="mr-2 h-4 w-4" /> Add Judge</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{judgeToEdit ? 'Edit Judge' : 'Add New Judge'}</DialogTitle></DialogHeader>
                        <form onSubmit={handleJudgeSubmit} className="grid gap-4 py-4">
                          <Input name="name" placeholder="Judge Name" defaultValue={judgeToEdit?.name} required />
                          <Input name="email" type="email" placeholder="Judge Email" defaultValue={judgeToEdit?.email} required />
                          <Input name="password" type="password"
                            placeholder={judgeToEdit ? 'New Password (optional)' : 'Password'}
                            required={!judgeToEdit} />
                          <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                            <Button type="submit">{judgeToEdit ? 'Save Changes' : 'Add Judge'}</Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventJudges?.map((judge) => (
                        <TableRow key={judge.id}>
                          <TableCell>{judge.name}</TableCell>
                          <TableCell>{judge.email}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => { setJudgeToEdit(judge); setJudgeDialogOpen(true); }}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive"
                              onClick={() => api.delete(`/api/judges/${judge.id}`)}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          !isLoading && (
            <div className="text-center py-16 border-2 border-dashed rounded-lg">
              <h3 className="text-xl font-semibold text-muted-foreground">No events found.</h3>
              <Button onClick={() => setEventDialogOpen(true)} className="mt-4">
                <PlusCircle className="mr-2 h-4 w-4" /> Add Event
              </Button>
            </div>
          )
        )}
      </main>

      {/* Score detail dialog */}
      <Dialog open={isScoreDetailOpen} onOpenChange={setScoreDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scores for {selectedCarForDetails?.make} {selectedCarForDetails?.model}</DialogTitle>
            <DialogDescription>Reg. ID: {selectedCarForDetails?.registrationId}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judge</TableHead><TableHead className="text-center">Score</TableHead><TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedCarJudgeScores.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{s.judgeName}</TableCell>
                  <TableCell className="text-center">
                    {s.score !== undefined && s.score !== null
                      ? <Badge variant="default">{s.score.toFixed(1)}</Badge>
                      : <Badge variant="secondary">Not Scored</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.notes || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
