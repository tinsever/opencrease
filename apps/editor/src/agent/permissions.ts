// Permission questions from the server ("may this agent use OpenCrease?"), answered in PermissionHost.
import { useSyncExternalStore } from "react";
import type { AgentClientInfo } from "@opencrease/protocol";

export interface PermissionQuestion {
  id: number;
  client: AgentClientInfo;
  answer(allow: boolean): void;
}

let nextId = 1;
let queue: PermissionQuestion[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Queue a question for the user. Resolves with their answer. */
export function askPermission(client: AgentClientInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const q: PermissionQuestion = {
      id: nextId++,
      client,
      answer(allow) {
        queue = queue.filter((x) => x !== q);
        emit();
        resolve(allow);
      },
    };
    queue = [...queue, q];
    emit();

  });
}

export function usePermissionQuestions(): PermissionQuestion[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue,
  );
}
