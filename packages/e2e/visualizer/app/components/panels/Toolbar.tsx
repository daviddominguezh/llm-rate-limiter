"use client";

import { Upload, Download, Plus, WandSparkles, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ToolbarProps {
  onAddNode: () => void;
  onImport: () => void;
  onExport: () => void;
}

export function Toolbar({ onImport, onExport }: ToolbarProps) {
  return (
    <header className="absolute z-1 flex items-center justify-center gap-2 border rounded-lg bg-background p-1 top-2 shadow-lg">
      <Button className="h-8 w-8" variant="ghost" size="sm">
        <Play className="h-4 w-4" />
      </Button>
      <Button className="h-8 w-8" variant="ghost" size="sm" onClick={onImport}>
        <Upload className="h-4 w-4" />
      </Button>
      <Button className="h-8 w-8" variant="ghost" size="sm" onClick={onExport}>
        <Download className="h-4 w-4" />
      </Button>
      <Button className="h-8 w-8" variant="ghost" size="sm">
        <WandSparkles className="h-4 w-4" />
      </Button>
    </header>
  );
}
