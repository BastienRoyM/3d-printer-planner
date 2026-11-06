import { useState } from "react";
import {
  Anchor, Apple, Armchair, Bed, Bike, Bird, Blocks, Bolt, Bot, Box, Boxes, Brush, Bug, Cake, Camera, Car, Carrot, Cat,
  CircuitBoard, Cog, Compass, Cone, Construction, Container, Cpu, Crown, Cuboid, Cylinder, Diamond, Dice5, Dog, Drill,
  Fence, Fish, Flag, Flame, Flower2, Gamepad2, Ghost, Gift, Glasses, Globe, Hammer, Headphones, Heart, Hexagon, Home,
  Joystick, Key, Lamp, Layers, Leaf, Lightbulb, Lock, Magnet, Map as MapIcon, Medal, Monitor, Moon, Mountain, Music, Package,
  Palette, PenTool, Pizza, Plane, Plug, Printer, Puzzle, Pyramid, Rabbit, Rocket, Ruler, Scissors, Shapes, Shield, Ship,
  Shirt, Skull, Smartphone, Snowflake, Sofa, Sparkles, Sprout, Star, Sun, Sword, Swords, Target, Tent, ToyBrick, TrainFront,
  TreePine, Trophy, Umbrella, Utensils, Wand2, Warehouse, Watch, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "./Modal";

/** The icon collection projects and queues pick from. Keys are stored in the database. */
export const ICONS: Record<string, LucideIcon> = {
  Box, Boxes, Package, Layers, Cuboid, Cylinder, Cone, Pyramid, Hexagon, Diamond, Shapes, Blocks, ToyBrick, Puzzle,
  Printer, Wrench, Hammer, Drill, Ruler, Scissors, Cog, Bolt, Magnet, Construction, Fence, Container, Warehouse, Home,
  Tent, Armchair, Sofa, Bed, Lamp, Lightbulb, Plug, Zap, Cpu, CircuitBoard, Monitor, Smartphone, Headphones, Camera,
  Watch, Glasses, Shirt, Gamepad2, Joystick, Dice5, Bot, Rocket, Plane, Car, Bike, TrainFront, Ship, Anchor, Ghost,
  Skull, Sword, Swords, Shield, Crown, Wand2, Sparkles, Trophy, Medal, Target, Flag, Star, Heart, Gift, Cake, Pizza,
  Utensils, Apple, Carrot, Dog, Cat, Rabbit, Bird, Fish, Bug, Flower2, Leaf, Sprout, TreePine, Mountain, Sun, Moon,
  Snowflake, Flame, Umbrella, Globe, Map: MapIcon, Compass, Key, Lock, Music, Palette, Brush, PenTool,
};

/** Draws a stored icon name, or `fallback` when it is unset or unknown. */
export function EntityIcon({ name, fallback, size = 16, color }: {
  name: string | null;
  fallback: LucideIcon;
  size?: number;
  color?: string;
}) {
  const Icon = (name && ICONS[name]) || fallback;
  return <Icon size={size} color={color} aria-hidden="true" />;
}

/** Splits "TreePine" into "tree pine" so the search box finds it. */
const words = (key: string) => key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();

export function IconPicker({ title, current, color, onPick, onClose }: {
  title: string;
  current: string | null;
  color?: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const names = Object.keys(ICONS).filter((k) => !q || words(k).includes(q));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>Search icons</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="rocket, tree, car…" autoFocus />
        </label>
        <div className="icon-grid" role="listbox" aria-label="Icons">
          {names.map((k) => {
            const Icon = ICONS[k];
            return (
              <button
                key={k}
                role="option"
                aria-selected={k === current}
                aria-label={words(k)}
                title={words(k)}
                className={`icon-choice${k === current ? " is-selected" : ""}`}
                onClick={() => onPick(k)}
              >
                <Icon size={20} color={k === current ? color : undefined} />
              </button>
            );
          })}
          {names.length === 0 && <p className="hint">No icon matches “{query}”.</p>}
        </div>
      </div>
    </Modal>
  );
}
