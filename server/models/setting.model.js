import mongoose, { Schema, model } from "mongoose";

const settingSchema = new Schema({
  commentNotification: {
    type: Boolean,
    default: true,
  },
  videoLikedNotification: {
    type: Boolean,
    default: true,
  },
  newFollowerNotification: {
    type: Boolean,
    default: true,
  },
  watchHistoryOn: {
    type: Boolean,
    default: true,
  },
  newVideoNotification: {
    // new video from the channels you follow
    type: Boolean,
    default: true,
  },
});

const Setting = model("Setting", settingSchema);

export default Setting;
