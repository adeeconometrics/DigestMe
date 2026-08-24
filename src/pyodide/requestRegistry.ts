import type { WireValue } from "../types";

export interface RegisteredRequest {
  payload: string;
  onStream?: (event: WireValue) => void;
}

export interface RequestRegistry {
  register: (requestId: number, request: RegisteredRequest) => void;
  remove: (requestId: number) => void;
  dispatch: (requestId: number, event: WireValue) => void;
}

export function createRequestRegistry(): RequestRegistry {
  const requests = new Map<number, RegisteredRequest>();

  return {
    register(requestId, request) {
      requests.set(requestId, request);
    },
    remove(requestId) {
      requests.delete(requestId);
    },
    dispatch(requestId, event) {
      requests.get(requestId)?.onStream?.(event);
    },
  };
}
