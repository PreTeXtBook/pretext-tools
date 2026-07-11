import { createSlice } from "@reduxjs/toolkit";
import { defaultContent } from "./defaultContent";

const initialState = {
  value: defaultContent,
  editor: null,
};

const ptxSourceSlice = createSlice({
  name: "ptxSource",
  initialState,
  reducers: {
    //Functions that modify the state
    setPtxSource: (state, action) => {
      state.value = action.payload.value;
      state.editor = action.payload.editor;
    },
  },
});

export const { setPtxSource } = ptxSourceSlice.actions;
export default ptxSourceSlice.reducer;
