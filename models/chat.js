import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  history: [
    {
      role: { type: String, required: true },  // 'user' or 'assistant'
      content: { type: String, required: true },  // The actual message content
      img: { type: String },  // Optional image field if needed
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Chat", chatSchema);
