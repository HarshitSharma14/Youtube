import mongoose from "mongoose";
const { Schema, model } = mongoose;
import { videoCategoryEnum } from "../utils/constants.js";

const videoSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, "Video Title required"],
    },
    category: {
      type: String,
      enum: videoCategoryEnum,
      required: true,
    },
    description: {
      type: String,
    },
    videoUrl: {
      type: String,
      required: [true, "Video url required"],
    },
    thumbnailUrl: {
      type: String,
      default: "", // default thumbnail
    },
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    channelName: { type: String },
    duration: {
      type: Number, //in seconds
      required: true,
    },
    channel: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    commentCount: {
      type: Number,
      default: 0,
    },
    canComment: {
      type: Boolean,
      default: true,
    },
    embedding: { type: [Number], required: false },
  },
  { timestamps: true }
);

videoSchema.index({ title: "text", description: "text", category: "text" });


const Video = model("Video", videoSchema);

export default Video;
