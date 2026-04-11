import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

type Car = { id: string; eventId: string; registrationId: number; ownerInfo: string; make: string; model: string; year: number; color: string };
type Score = { id: string; carId: string; judgeId: string; eventId: string; score: number | null; notes: string };
type CarWithScore = Car & { score: Score | undefined };

const scoringSchema = z.object({
  score: z.number().min(0).max(10),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters.').optional(),
});

type ScoringFormValues = z.infer<typeof scoringSchema>;

interface ScoringDialogProps {
  car: CarWithScore | null;
  judgeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (carId: string, judgeId: string, score: number, notes: string) => void;
}

export function ScoringDialog({ car, judgeId, open, onOpenChange, onSave }: ScoringDialogProps) {
  const form = useForm<ScoringFormValues>({
    resolver: zodResolver(scoringSchema),
    defaultValues: {
      score: car?.score?.score ?? 7.5,
      notes: car?.score?.notes ?? '',
    },
  });

  React.useEffect(() => {
    if (car) {
      form.reset({
        score: car.score?.score ?? 7.5,
        notes: car.score?.notes ?? '',
      });
    }
  }, [car, form]);

  const onSubmit = (data: ScoringFormValues) => {
    if (car && judgeId) {
      onSave(car.id, judgeId, data.score, data.notes || '');
    }
  };

  if (!car) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Score: {car.make} {car.model}</SheetTitle>
          <SheetDescription>
            Enter your score and notes for this vehicle. Your feedback is valuable.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-grow space-y-8 py-4">
            <FormField
              control={form.control}
              name="score"
              render={({ field }) => (
                <FormItem className="py-4">
                  <FormLabel>Score: {field.value.toFixed(1)} / 10.0</FormLabel>
                  <FormControl>
                    <Slider
                      min={0} max={10} step={0.1}
                      value={[field.value]}
                      onValueChange={(values) => field.onChange(values[0])}
                      className="py-2"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Immaculate interior, minor scratch on passenger door."
                      {...field}
                      rows={6}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SheetFooter className="absolute bottom-6 right-6 left-6">
              <SheetClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </SheetClose>
              <Button type="submit">Save Score</Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
