import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "todo" | "printing" | "done" | "failed";
export const STATUSES: Status[] = ["todo", "printing", "done", "failed"];

export interface Project {
  id: number;
  name: string;
  description: string;
  color: string | null;
  folderRel: string;
  archived: boolean;
  createdAt: string;
}

export interface ProjectSummary {
  project: Project;
  totalPrints: number;
  donePrints: number;
  itemsTotal: number;
  itemsDone: number;
  remainingMinutes: number;
  remainingGrams: number;
}

export interface Queue {
  id: number;
  projectId: number;
  name: string;
  folderRel: string;
}

export interface QueueSummary {
  queue: Queue;
  totalPrints: number;
  donePrints: number;
  printingCount: number;
  nextItem: Item | null;
}

export interface ItemFile {
  id: number;
  itemId: number;
  relPath: string;
  kind: "model" | "project" | "gcode";
  isOriginal: boolean;
  addedAt: string;
}

export interface Item {
  id: number;
  queueId: number;
  name: string;
  status: Status;
  qtyTotal: number;
  qtyDone: number;
  copiesPerPlate: number;
  material: string | null;
  color: string | null;
  notes: string;
  estMinutes: number | null;
  estGrams: number | null;
  printerId: number | null;
  thumbnail: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  files: ItemFile[];
}

export interface PrintEvent {
  id: number;
  itemId: number;
  printerId: number | null;
  kind: "started" | "finished" | "failed" | "reset";
  copies: number;
  at: string;
}

export type ItemPatch = Partial<
  Pick<
    Item,
    "name" | "qtyTotal" | "qtyDone" | "copiesPerPlate" | "material" | "color" | "notes" | "estMinutes" | "estGrams"
  >
>;

export type Action =
  | { type: "start" }
  | { type: "finish" }
  | { type: "fail" }
  | { type: "resetProgress" }
  | { type: "moveTo"; status: Status };

export interface AppInfo {
  libraryPath: string;
  slicerPath: string | null;
  detectedSlicer: string | null;
  theme: "dark" | "light";
}

export interface ImportResult {
  imported: Item[];
  skipped: string[];
}

export const SUPPORTED_EXTENSIONS = ["stl", "3mf", "obj", "step", "stp", "amf", "gcode"];

export const getAppInfo = () => invoke<AppInfo>("get_app_info");
export const setSetting = (key: "theme" | "slicer_path", value: string) =>
  invoke<void>("set_setting", { key, value });
export const moveLibrary = (newPath: string) =>
  invoke<{ libraryPath: string; warning: string | null }>("move_library", { newPath });

export const listProjects = () => invoke<ProjectSummary[]>("list_projects");
export const createProject = (name: string, description?: string, color?: string) =>
  invoke<Project>("create_project", { name, description, color });
export const updateProject = (
  id: number,
  patch: { name?: string; description?: string; color?: string; archived?: boolean },
) => invoke<Project>("update_project", { id, ...patch });
export const deleteProject = (id: number) => invoke<void>("delete_project", { id });

export const listQueues = (projectId: number) => invoke<QueueSummary[]>("list_queues", { projectId });
export const createQueue = (projectId: number, name: string) => invoke<Queue>("create_queue", { projectId, name });
export const renameQueue = (id: number, name: string) => invoke<Queue>("rename_queue", { id, name });
export const deleteQueue = (id: number) => invoke<void>("delete_queue", { id });

export const listItems = (queueId: number) => invoke<Item[]>("list_items", { queueId });
export const importFiles = (queueId: number, paths: string[]) =>
  invoke<ImportResult>("import_files", { queueId, paths });
export const updateItem = (id: number, patch: ItemPatch) => invoke<Item>("update_item", { id, patch });
export const itemAction = (id: number, action: Action, index?: number) =>
  invoke<Item>("item_action", { id, action, index });
export const deleteItem = (id: number) => invoke<void>("delete_item", { id });
export const itemHistory = (id: number) => invoke<PrintEvent[]>("item_history", { id });
export const listUnassigned = (queueId: number) => invoke<string[]>("list_unassigned", { queueId });
export const attachFile = (itemId: number, fileName: string) =>
  invoke<Item>("attach_file", { itemId, fileName });
export const itemFromFile = (queueId: number, fileName: string) =>
  invoke<Item>("item_from_file", { queueId, fileName });
export const openInSlicer = (itemId: number) => invoke<void>("open_in_slicer", { itemId });
export const revealItem = (itemId: number) => invoke<void>("reveal_item", { itemId });
export const readModel = (itemId: number) => invoke<ArrayBuffer>("read_model", { itemId });
export const saveThumbnail = (itemId: number, dataUrl: string) =>
  invoke<void>("save_thumbnail", { itemId, dataUrl });

export const onLibraryChanged = (cb: () => void): Promise<UnlistenFn> => listen("library-changed", cb);

export function fileName(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong";
}
