import { create } from 'zustand';
import type { LocalApiServiceState } from '@/types/bridge.types';

interface LocalApiStatusState {
  serviceState: Record<'netease' | 'qq', LocalApiServiceState>;
}

interface LocalApiStatusActions {
  setServiceState: (nextState: Record<'netease' | 'qq', LocalApiServiceState>) => void;
}

const INITIAL_SERVICE_STATE: Record<'netease' | 'qq', LocalApiServiceState> = {
  netease: 'pending',
  qq: 'pending',
};

export const useLocalApiStatusStore = create<LocalApiStatusState & LocalApiStatusActions>((set) => ({
  serviceState: INITIAL_SERVICE_STATE,
  setServiceState: (nextState) => set({ serviceState: nextState }),
}));
