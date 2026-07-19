import { Box } from "lucide-react";
import { t, useLocale } from "../../i18n.js";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "../components/menubar.js";
import type { EditorPaintTool } from "./EditorToolbar.js";

interface EditorMenuBarProps {
  adventureName: string;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  onExit(): void;
  onNewMap(): void;
  onSave(): void;
  onDeleteMap(): void;
  onOpenSettings(): void;
  onUndo(): void;
  onRedo(): void;
  onSelectLayer(layer: 0 | 1 | 2): void;
  onSelectTool(tool: EditorPaintTool): void;
  onToggleGrid(): void;
  onSetZoom(zoom: number): void;
  onTest(): void;
}

/**
 * The wireframe's 32px menu row: the adventure identity (doubling as the way back to the parties
 * home until the account menu lands) and the six menus. Items whose action does not exist this
 * tranche — Base de données…, Estomper les autres calques — render disabled, never hidden: the menu
 * structure is the contract. No account menu: the store carries no username/email to fill it, and
 * inventing that plumbing is out of scope.
 */
export function EditorMenuBar({
  adventureName,
  canUndo,
  canRedo,
  showGrid,
  onExit,
  onNewMap,
  onSave,
  onDeleteMap,
  onOpenSettings,
  onUndo,
  onRedo,
  onSelectLayer,
  onSelectTool,
  onToggleGrid,
  onSetZoom,
  onTest,
}: EditorMenuBarProps) {
  useLocale();
  return (
    <div className="flex h-8 flex-none items-stretch border-b border-zinc-200 bg-white px-1.5">
      <button
        type="button"
        onClick={onExit}
        aria-label={t("editor.shell.exit.aria")}
        className="mr-1 flex items-center gap-2 rounded-md px-2 hover:bg-zinc-100"
      >
        <span className="flex size-4 items-center justify-center rounded bg-zinc-900 text-zinc-50">
          <Box className="size-2.5" />
        </span>
        <span className="max-w-32 truncate text-[12.5px] font-semibold">{adventureName}</span>
      </button>

      <Menubar className="h-8 gap-0 rounded-none border-none bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger>{t("editor.shell.menu.file")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNewMap}>
              {t("editor.new")}
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onSave}>
              {t("editor.save")}
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onOpenSettings}>{t("editor.shell.settings")}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem variant="destructive" onClick={onDeleteMap}>
              {t("editor.shell.deleteMap")}
            </MenubarItem>
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
            <MenubarItem onClick={() => onSelectLayer(0)}>
              {t("editor.shell.layer", { n: 1 })}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectLayer(1)}>
              {t("editor.shell.layer", { n: 2 })}
            </MenubarItem>
            <MenubarItem onClick={() => onSelectLayer(2)}>
              {t("editor.shell.layer", { n: 3 })}
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
            <MenubarItem disabled>{t("editor.shell.dimOtherLayers")}</MenubarItem>
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
            <MenubarItem disabled>{t("editor.shell.database")}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="flex-1" />
    </div>
  );
}
