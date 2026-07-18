import { Box } from "lucide-react";
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
  onUndo,
  onRedo,
  onSelectLayer,
  onSelectTool,
  onToggleGrid,
  onSetZoom,
  onTest,
}: EditorMenuBarProps) {
  return (
    <div className="flex h-8 flex-none items-stretch border-b border-zinc-200 bg-white px-1.5">
      <button
        type="button"
        onClick={onExit}
        aria-label="Quitter l'éditeur"
        className="mr-1 flex items-center gap-2 rounded-md px-2 hover:bg-zinc-100"
      >
        <span className="flex size-4 items-center justify-center rounded bg-zinc-900 text-zinc-50">
          <Box className="size-2.5" />
        </span>
        <span className="max-w-32 truncate text-[12.5px] font-semibold">{adventureName}</span>
      </button>

      <Menubar className="h-8 gap-0 rounded-none border-none bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger>Fichier</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNewMap}>
              Nouvelle carte
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onSave}>
              Enregistrer
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem variant="destructive" onClick={onDeleteMap}>
              Supprimer la carte
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Édition</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!canUndo} onClick={onUndo}>
              Annuler
              <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!canRedo} onClick={onRedo}>
              Rétablir
              <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Mode</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => onSelectLayer(0)}>Calque 1</MenubarItem>
            <MenubarItem onClick={() => onSelectLayer(1)}>Calque 2</MenubarItem>
            <MenubarItem onClick={() => onSelectLayer(2)}>Calque 3</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Outils</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => onSelectTool("select")}>Sélection</MenubarItem>
            <MenubarItem onClick={() => onSelectTool("pencil")}>Crayon</MenubarItem>
            <MenubarItem onClick={() => onSelectTool("rect")}>Rectangle</MenubarItem>
            <MenubarItem onClick={() => onSelectTool("fill")}>Remplissage</MenubarItem>
            <MenubarItem onClick={() => onSelectTool("eraser")}>Gomme</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Affichage</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onToggleGrid}>
              {showGrid ? "Masquer la grille" : "Afficher la grille"}
            </MenubarItem>
            <MenubarItem disabled>Estomper les autres calques</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => onSetZoom(100)}>Zoom 100%</MenubarItem>
            <MenubarItem onClick={() => onSetZoom(200)}>Zoom 200%</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Jeu</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onTest}>Tester</MenubarItem>
            <MenubarItem disabled>Base de données…</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="flex-1" />
    </div>
  );
}
