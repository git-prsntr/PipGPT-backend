import mongoose from "mongoose";

const pinnedChatsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    pinnedChats: [
      {
        _id: {
          type: String,
          required: true,
        },
        title: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.models.pinnedChats ||
  mongoose.model("pinnedChats", pinnedChatsSchema);