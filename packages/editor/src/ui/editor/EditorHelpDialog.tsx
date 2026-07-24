import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { Badge } from "@lindocara/ui/components/badge.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@lindocara/ui/components/tabs.js";

export const EDITOR_HELP_SECTIONS = ["start", "maps", "story", "quests", "state", "test"] as const;

export type EditorHelpSection = (typeof EDITOR_HELP_SECTIONS)[number];

interface EditorHelpDialogProps {
  open: boolean;
  section: EditorHelpSection;
  onOpenChange(open: boolean): void;
  onSectionChange(section: EditorHelpSection): void;
}

const START_STEPS = [
  ["editor.help.start.step1.title", "editor.help.start.step1.body"],
  ["editor.help.start.step2.title", "editor.help.start.step2.body"],
  ["editor.help.start.step3.title", "editor.help.start.step3.body"],
  ["editor.help.start.step4.title", "editor.help.start.step4.body"],
  ["editor.help.start.step5.title", "editor.help.start.step5.body"],
  ["editor.help.start.step6.title", "editor.help.start.step6.body"],
  ["editor.help.start.step7.title", "editor.help.start.step7.body"],
  ["editor.help.start.step8.title", "editor.help.start.step8.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const MAP_MODE_ROWS = [
  ["editor.help.maps.mode.terrain", "editor.help.maps.mode.terrain.body"],
  ["editor.help.maps.mode.elements", "editor.help.maps.mode.elements.body"],
  ["editor.help.maps.mode.events", "editor.help.maps.mode.events.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const MAP_TOOL_ROWS = [
  ["editor.help.maps.tool.pencil", "editor.help.maps.tool.pencil.body"],
  ["editor.help.maps.tool.rect", "editor.help.maps.tool.rect.body"],
  ["editor.help.maps.tool.fill", "editor.help.maps.tool.fill.body"],
  ["editor.help.maps.tool.eraser", "editor.help.maps.tool.eraser.body"],
  ["editor.help.maps.tool.select", "editor.help.maps.tool.select.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const EVENT_ROWS = [
  ["editor.help.story.preset.dialogue", "editor.help.story.preset.dialogue.body"],
  ["editor.help.story.preset.chest", "editor.help.story.preset.chest.body"],
  ["editor.help.story.preset.teleporter", "editor.help.story.preset.teleporter.body"],
  ["editor.help.story.preset.end", "editor.help.story.preset.end.body"],
  ["editor.help.story.preset.monster", "editor.help.story.preset.monster.body"],
  ["editor.help.story.preset.start", "editor.help.story.preset.start.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const QUEST_STEPS = [
  ["editor.help.quests.step1.title", "editor.help.quests.step1.body"],
  ["editor.help.quests.step2.title", "editor.help.quests.step2.body"],
  ["editor.help.quests.step3.title", "editor.help.quests.step3.body"],
  ["editor.help.quests.step4.title", "editor.help.quests.step4.body"],
  ["editor.help.quests.step5.title", "editor.help.quests.step5.body"],
  ["editor.help.quests.step6.title", "editor.help.quests.step6.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const OBJECTIVE_ROWS = [
  ["editor.quest.objective.type.kill", "editor.help.quests.objective.kill"],
  ["editor.quest.objective.type.defeat-target", "editor.help.quests.objective.defeatTarget"],
  ["editor.quest.objective.type.collect", "editor.help.quests.objective.collect"],
  ["editor.quest.objective.type.deliver", "editor.help.quests.objective.deliver"],
  ["editor.quest.objective.type.interact", "editor.help.quests.objective.interact"],
  ["editor.quest.objective.type.reach", "editor.help.quests.objective.reach"],
  ["editor.quest.objective.type.use-item", "editor.help.quests.objective.useItem"],
  ["editor.quest.objective.type.activity", "editor.help.quests.objective.activity"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const STATE_ROWS = [
  ["editor.help.state.boolean.title", "editor.help.state.boolean.body"],
  ["editor.help.state.counter.title", "editor.help.state.counter.body"],
  ["editor.help.state.local.title", "editor.help.state.local.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const TEST_ROWS = [
  ["editor.help.test.quick.title", "editor.help.test.quick.body"],
  ["editor.help.test.full.title", "editor.help.test.full.body"],
  ["editor.help.test.validation.title", "editor.help.test.validation.body"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

/**
 * Task-oriented documentation for the complete creator. It deliberately explains concepts in
 * author language (place, character, remembered state, counter) before naming the RPG-editor term.
 * No UUID, JSON or command syntax is required anywhere in these flows.
 */
export function EditorHelpDialog({
  open,
  section,
  onOpenChange,
  onSectionChange,
}: EditorHelpDialogProps) {
  useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader className="flex-none pr-8">
          <DialogTitle>{t("editor.help.title")}</DialogTitle>
          <DialogDescription>{t("editor.help.subtitle")}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={section}
          onValueChange={(value) => onSectionChange(value as EditorHelpSection)}
          className="min-h-0 flex-1"
        >
          <TabsList
            variant="line"
            className="w-full flex-none justify-start overflow-x-auto border-b border-border pb-1"
          >
            {EDITOR_HELP_SECTIONS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`editor.help.tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="start" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
                <h3 className="font-semibold">{t("editor.help.start.mentalModel.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed">
                  {t("editor.help.start.mentalModel.body")}
                </p>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-base font-semibold">{t("editor.help.start.workflow")}</h3>
                  <Badge variant="secondary">{t("editor.help.noCode")}</Badge>
                </div>
                <ol className="grid gap-3 md:grid-cols-2">
                  {START_STEPS.map(([title, body], index) => (
                    <li key={title} className="flex gap-3 rounded-lg border border-border p-3">
                      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="font-medium">{t(title)}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {t(body)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{t("editor.help.start.where.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.start.where.body")}
                </p>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="maps" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <header>
                <h3 className="text-base font-semibold">{t("editor.help.maps.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.maps.intro")}
                </p>
              </header>

              <section className="grid gap-3 md:grid-cols-3">
                {MAP_MODE_ROWS.map(([title, body]) => (
                  <article key={title} className="rounded-lg border border-border p-3">
                    <h4 className="font-medium">{t(title)}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(body)}</p>
                  </article>
                ))}
              </section>

              <section>
                <h3 className="mb-2 font-semibold">{t("editor.help.maps.tools.title")}</h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  {MAP_TOOL_ROWS.map(([title, body]) => (
                    <div
                      key={title}
                      className="grid gap-1 border-b border-border p-3 last:border-b-0 sm:grid-cols-[10rem_1fr]"
                    >
                      <strong className="text-sm">{t(title)}</strong>
                      <span className="text-sm text-muted-foreground">{t(body)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <h3 className="font-semibold">{t("editor.help.maps.relief.title")}</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                  <li>{t("editor.help.maps.relief.step1")}</li>
                  <li>{t("editor.help.maps.relief.step2")}</li>
                  <li>{t("editor.help.maps.relief.step3")}</li>
                  <li>{t("editor.help.maps.relief.step4")}</li>
                </ol>
                <p className="mt-2 text-sm font-medium">{t("editor.help.maps.relief.rule")}</p>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <article className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">{t("editor.help.maps.multimap.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("editor.help.maps.multimap.body")}
                  </p>
                </article>
                <article className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">{t("editor.help.maps.collision.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("editor.help.maps.collision.body")}
                  </p>
                </article>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="story" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <header>
                <h3 className="text-base font-semibold">{t("editor.help.story.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.story.intro")}
                </p>
              </header>

              <section className="grid gap-3 md:grid-cols-2">
                {EVENT_ROWS.map(([title, body]) => (
                  <article key={title} className="rounded-lg border border-border p-3">
                    <h4 className="font-medium">{t(title)}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(body)}</p>
                  </article>
                ))}
              </section>

              <section className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{t("editor.help.story.eventEditor.title")}</h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  <li>{t("editor.help.story.eventEditor.page")}</li>
                  <li>{t("editor.help.story.eventEditor.condition")}</li>
                  <li>{t("editor.help.story.eventEditor.trigger")}</li>
                  <li>{t("editor.help.story.eventEditor.content")}</li>
                </ol>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <article className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-violet-950">
                  <h3 className="font-semibold">{t("editor.help.story.dialogue.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed">
                    {t("editor.help.story.dialogue.body")}
                  </p>
                </article>
                <article className="rounded-lg border border-border p-4">
                  <h3 className="font-semibold">{t("editor.help.story.interactive.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("editor.help.story.interactive.body")}
                  </p>
                </article>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="quests" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <header>
                <h3 className="text-base font-semibold">{t("editor.help.quests.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.quests.intro")}
                </p>
              </header>

              <section>
                <h3 className="mb-2 font-semibold">{t("editor.help.quests.workflow")}</h3>
                <ol className="grid gap-3 md:grid-cols-2">
                  {QUEST_STEPS.map(([title, body], index) => (
                    <li key={title} className="flex gap-3 rounded-lg border border-border p-3">
                      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="font-medium">{t(title)}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {t(body)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <h3 className="mb-2 font-semibold">{t("editor.help.quests.objectives.title")}</h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  {OBJECTIVE_ROWS.map(([title, body]) => (
                    <div
                      key={title}
                      className="grid gap-1 border-b border-border p-3 last:border-b-0 sm:grid-cols-[13rem_1fr]"
                    >
                      <strong className="text-sm">{t(title)}</strong>
                      <span className="text-sm leading-relaxed text-muted-foreground">
                        {t(body)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <article className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
                  <h3 className="font-semibold">{t("editor.help.quests.links.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed">
                    {t("editor.help.quests.links.body")}
                  </p>
                </article>
                <article className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-violet-950">
                  <h3 className="font-semibold">{t("editor.help.quests.texts.title")}</h3>
                  <p className="mt-1 text-sm leading-relaxed">
                    {t("editor.help.quests.texts.body")}
                  </p>
                </article>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="state" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <header>
                <h3 className="text-base font-semibold">{t("editor.help.state.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.state.intro")}
                </p>
              </header>

              <section className="grid gap-3 md:grid-cols-3">
                {STATE_ROWS.map(([title, body]) => (
                  <article key={title} className="rounded-lg border border-border p-4">
                    <h4 className="font-medium">{t(title)}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(body)}</p>
                  </article>
                ))}
              </section>

              <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <h3 className="font-semibold">{t("editor.help.state.example.title")}</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                  <li>{t("editor.help.state.example.step1")}</li>
                  <li>{t("editor.help.state.example.step2")}</li>
                  <li>{t("editor.help.state.example.step3")}</li>
                  <li>{t("editor.help.state.example.step4")}</li>
                </ol>
              </section>

              <section className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{t("editor.help.state.pages.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.state.pages.body")}
                </p>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="test" className="min-h-0 overflow-y-auto p-1 pr-3">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 py-3">
              <header>
                <h3 className="text-base font-semibold">{t("editor.help.test.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.test.intro")}
                </p>
              </header>

              <section className="grid gap-3 md:grid-cols-3">
                {TEST_ROWS.map(([title, body]) => (
                  <article key={title} className="rounded-lg border border-border p-4">
                    <h4 className="font-medium">{t(title)}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(body)}</p>
                  </article>
                ))}
              </section>

              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <h3 className="font-semibold">{t("editor.help.test.checklist.title")}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                  <li>{t("editor.help.test.checklist.start")}</li>
                  <li>{t("editor.help.test.checklist.maps")}</li>
                  <li>{t("editor.help.test.checklist.quests")}</li>
                  <li>{t("editor.help.test.checklist.dialogue")}</li>
                  <li>{t("editor.help.test.checklist.end")}</li>
                  <li>{t("editor.help.test.checklist.multiplayer")}</li>
                </ul>
              </section>

              <section className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{t("editor.help.shortcuts.title")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("editor.help.shortcuts.body")}
                </p>
              </section>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-none">
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t("editor.help.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
