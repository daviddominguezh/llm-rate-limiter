'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function Visualizer() {
  return (
    <div className="container mx-auto py-12">
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">E2E Test Visualizer</h1>
          <p className="text-muted-foreground">
            Visualize rate limiter e2e test results
          </p>
        </div>
        <div className="grid gap-4 max-w-lg mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Timeseries Visualization</CardTitle>
              <CardDescription>
                View test results as an interactive timeseries chart showing jobs,
                rate limits, and capacity over time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/timeseries">
                <Button className="w-full">Open Timeseries Chart</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
