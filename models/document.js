import mongoose from "mongoose";

const documentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: {type: String, required:true}, // S3 url of the file
    contentType: { type: String, required: true }, // MIME type (e.g., "application/pdf")
    uploadedAt: { type: Date, default: Date.now },
});

export default mongoose.models.Document || mongoose.model("Document", documentSchema);
