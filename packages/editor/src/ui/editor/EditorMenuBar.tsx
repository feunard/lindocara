import { t, useLocale } from "@lindocara/client/i18n.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@lindocara/ui/components/menubar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@lindocara/ui/components/tooltip.js";
import { Box, LogOut } from "lucide-react";
import type { EditorMode } from "../../game/editor-state.js";
import type { EditorPaintTool } from "./EditorToolbar.js";

interface EditorMenuBarProps {
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  showDim: boolean;
  /** D18: the collision-visualisation overlay toggle's current state, mirrored in the View menu
   *  exactly like `showGrid`/`showDim`. */
  showCollisions: boolean;
  /** Quit the editor back to the parties screen (dirty-guarded), from File → « Quitter l'éditeur »
   *  AND from the menu bar's own Quit button (C8: the File-menu item alone was undiscoverable). */
  onExit(): void;
  /** Open the "Load an adventure" dialog, from File → « Charger une aventure ». */
  onOpenLoad(): void;
  onNewMap(): void;
  onSave(): void;
  onOpenSettings(): void;
  onOpenQuests(): void;
  onOpenDatabase(): void;
  onUndo(): void;
  onRedo(): void;
  onSelectMode(mode: EditorMode): void;
  onSelectTool(tool: EditorPaintTool): void;
  onToggleGrid(): void;
  onToggleDim(): void;
  onToggleCollisions(): void;
  onSetZoom(zoom: number): void;
  onTest(): void;
}

/**
 * The wireframe's 32px menu row: a static « Editor » brand chip (UX wave #16 — no longer the
 * adventure name, and still not itself clickable), a dedicated Quit icon button beside it (C8), and
 * the six menus. File → « Charger une aventure » opens the load dialog; Jeu → « Base de données… »
 * opens the registry editor. No account menu: the store carries no username/email to fill it, and
 * inventing that plumbing is out of scope.
 */
export function EditorMenuBar({
  canUndo,
  canRedo,
  showGrid,
  showDim,
  showCollisions,
  onExit,
  onOpenLoad,
  onNewMap,
  onSave,
  onOpenSettings,
  onOpenQuests,
  onOpenDatabase,
  onUndo,
  onRedo,
  onSelectMode,
  onSelectTool,
  onToggleGrid,
  onToggleDim,
  onToggleCollisions,
  onSetZoom,
  onTest,
}: EditorMenuBarProps) {
  useLocale();
  return (
    <div className="flex h-8 flex-none items-stretch border-b border-zinc-200 bg-white px-1.5">
      {/* UX wave #16: a static brand chip, not a button. Leaving the editor is File → « Quitter
          l'éditeur », never a click on the chip, and the adventure name is no longer shown here. */}
      <div className="mr-1 flex items-center gap-2 px-2">
        <span className="flex size-4 items-center justify-center rounded bg-zinc-900 text-zinc-50">
          <Box className="size-2.5" />
        </span>
        <span className="text-[12.5px] font-semibold">{t("editor.shell.brand")}</span>
      </div>

      {/* C8: a small, always-visible Quit affordance beside the brand chip — the File-menu item
          alone left leaving the editor buried two clicks deep. Reuses the pre-existing (previously
          orphaned) `exit.aria` string rather than the File-menu's own "Quit the editor" label, so the
          icon-only button and the menu item read as two distinct affordances, not a duplicate. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("editor.shell.exit.aria")}
              onClick={onExit}
            >
              <LogOut />
            </Button>
          }
        />
        <TooltipContent>{t("editor.shell.exit.aria")}</TooltipContent>
      </Tooltip>

      <Menubar className="h-8 gap-0 rounded-none border-none bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.file")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNewMap}>
              {t("editor.new")}
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onOpenLoad}>{t("editor.shell.load")}</MenubarItem>
            <MenubarItem onClick={onSave}>
              {t("editor.save")}
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onOpenSettings}>{t("editor.shell.settings")}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onExit}>{t("editor.shell.quit")}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.edit")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!canUndo} onClick={onUndo}>
              {t("editor.undo")}
              <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!canRedo} onClick={onRedo}>
              {t("editor.redo")}
              <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.mode")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => onSelectMode("field")}>
              {t("editor.shell.mode.field")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectMode("element")}>
              {t("editor.shell.mode.element")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectMode("event")}>
              {t("editor.shell.mode.event")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.tools")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => onSelectTool("select")}>
              {t("editor.shell.tool.select")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectTool("pencil")}>
              {t("editor.shell.tool.pencil")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectTool("rect")}>
              {t("editor.shell.tool.rect")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectTool("fill")}>
              {t("editor.shell.tool.fill")}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectTool("eraser")}>
              {t("editor.tool.eraser")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.view")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onToggleGrid}>
              {showGrid ? t("editor.shell.grid.hide") : t("editor.shell.grid.show")}
            </MenubarItem>
            <MenubarItem onClick={onToggleDim}>
              {showDim ? "✓ " : ""}
              {t("editor.shell.dimOtherLayers")}
            </MenubarItem>
            <MenubarItem onClick={onToggleCollisions}>
              {showCollisions ? "✓ " : ""}
              {t("editor.shell.collisions.aria")}
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => onSetZoom(100)}>
              {t("editor.shell.zoomTo", { value: 100 })}
            </MenubarItem>
            <MenubarItem onClick={() => onSetZoom(200)}>
              {t("editor.shell.zoomTo", { value: 200 })}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.game")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onTest}>{t("editor.shell.test")}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onOpenQuests}>{t("editor.shell.quests")}</MenubarItem>
            <MenubarItem onClick={onOpenDatabase}>{t("editor.shell.database")}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="flex-1" />
    </div>
  );
}
