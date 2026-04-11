import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, LayoutDashboard, ClipboardPenLine } from 'lucide-react';

const CAR_IMAGE_URL =
  'https://images.unsplash.com/photo-1587750059638-e7e8c43b99fc?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3NDE5ODJ8MHwxfHNlYXJjaHwxfHxjbGFzc2ljJTIwY2FyfGVufDB8fHx8MTc2MzA4NjkwMnww&ixlib=rb-4.1.0&q=80&w=1080';

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen">
      <div className="relative flex-1 flex flex-col items-center justify-center p-4 text-center">
        <img
          src={CAR_IMAGE_URL}
          alt="A vibrant classic car show with multiple cars lined up."
          className="absolute inset-0 w-full h-full object-cover -z-10 brightness-[.3]"
        />
        <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-8 md:p-12 border border-white/10 max-w-4xl">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white font-headline">
            AutoScore Live
          </h1>
          <p className="mt-4 text-lg md:text-xl text-gray-300 max-w-2xl mx-auto">
            Collaborative, real-time scoring for premier classic car shows.
            Streamline judging and administration with effortless precision.
          </p>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-card/80 border-white/10 text-white flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <LayoutDashboard className="w-10 h-10 text-accent" />
                  <CardTitle className="text-2xl font-headline text-left">Admin Panel</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-grow text-left">
                <CardDescription className="text-gray-300">
                  Manage events, enter cars, register judges, and oversee the
                  entire scoring process from a centralized dashboard.
                </CardDescription>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Link to="/admin">
                    Go to Admin <ArrowRight className="ml-2" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
            <Card className="bg-card/80 border-white/10 text-white flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <ClipboardPenLine className="w-10 h-10 text-accent" />
                  <CardTitle className="text-2xl font-headline text-left">Judge's App</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-grow text-left">
                <CardDescription className="text-gray-300">
                  View your assigned vehicles, submit scores, and add notes
                  with a simple, intuitive interface designed for efficiency.
                </CardDescription>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Link to="/judge">
                    Go to Judging <ArrowRight className="ml-2" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
