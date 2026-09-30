import { type StoragePort } from "../../src/ui/api";
export function memoryStorage(): StoragePort {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
