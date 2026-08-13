import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { Dices, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  PROCEDURAL_MAP_COMPLEXITIES,
  PROCEDURAL_MAP_GENRES,
  PROCEDURAL_MAP_SIZES,
  type ProceduralMapComplexity,
  type ProceduralMapGenre,
  type ProceduralMapOptions,
  type ProceduralMapSize,
} from "../../game/procedural-map.js";

interface ProceduralMapDialogProps {
  open: boolean;
  mapName: string;
  onOpenChange(open: boolean): void;
  onGenerate(options: ProceduralMapOptions): void;
}

function freshSeed(): string {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}

function optionLabel(prefix: string, value: string): string {
  return t(`${prefix}.${value}` as MessageKey);
}

export function ProceduralMapDialog({
  open,
  mapName,
  onOpenChange,
  onGenerate,
}: ProceduralMapDialogProps) {
  useLocale();
  const [genre, setGenre] = useState<ProceduralMapGenre>("forest");
  const [size, setSize] = useState<ProceduralMapSize>("standard");
  const [complexity, setComplexity] = useState<ProceduralMapComplexity>("balanced");
  const [seed, setSeed] = useState(freshSeed);

  useEffect(() => {
    if (!open) return;
    setSeed(freshSeed());
  }, [open]);

  const dimensions = PROCEDURAL_MAP_SIZES[size];
  const seedValue = seed.trim();

  function generate(): void {
    if (!seedValue) return;
    onGenerate({ genre, size, complexity, seed: seedValue });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {t("editor.generator.title")}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t("editor.generator.hint")}</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="procedural-genre">{t("editor.generator.genre")}</Label>
            <Select value={genre} onValueChange={(value) => setGenre(value as ProceduralMapGenre)}>
              <SelectTrigger id="procedural-genre" className="w-full">
                <SelectValue>{optionLabel("editor.generator.genre", genre)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROCEDURAL_MAP_GENRES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {optionLabel("editor.generator.genre", value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="procedural-size">{t("editor.generator.size")}</Label>
            <Select value={size} onValueChange={(value) => setSize(value as ProceduralMapSize)}>
              <SelectTrigger id="procedural-size" className="w-full">
                <SelectValue>{optionLabel("editor.generator.size", size)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROCEDURAL_MAP_SIZES).map(([value, bounds]) => (
                  <SelectItem key={value} value={value}>
                    {optionLabel("editor.generator.size", value)} ({bounds.cols}×{bounds.rows})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="procedural-complexity">{t("editor.generator.complexity")}</Label>
            <Select
              value={complexity}
              onValueChange={(value) => setComplexity(value as ProceduralMapComplexity)}
            >
              <SelectTrigger id="procedural-complexity" className="w-full">
                <SelectValue>{optionLabel("editor.generator.complexity", complexity)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROCEDURAL_MAP_COMPLEXITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {optionLabel("editor.generator.complexity", value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="procedural-seed">{t("editor.generator.seed")}</Label>
            <div className="flex gap-1.5">
              <Input
                id="procedural-seed"
                value={seed}
                maxLength={48}
                onChange={(event) => setSeed(event.currentTarget.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("editor.generator.seed.random")}
                title={t("editor.generator.seed.random")}
                onClick={() => setSeed(freshSeed())}
              >
                <Dices />
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-muted/35 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {optionLabel("editor.generator.genre", genre)} · {dimensions.cols}×{dimensions.rows} ·{" "}
            {optionLabel("editor.generator.complexity", complexity)}
          </p>
          <p className="mt-1">{t(`editor.generator.genre.${genre}.hint` as MessageKey)}</p>
          <p className="mt-1">{t("editor.generator.contents")}</p>
        </div>

        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {t("editor.generator.warning", { name: mapName })}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("editor.delete.cancel")}
          </Button>
          <Button disabled={!seedValue} onClick={generate}>
            <Sparkles />
            {t("editor.generator.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
