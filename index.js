/**
 * @fileoverview This is the main server file for the application.
 * It initializes an Express server, connects to MongoDB, and handles various API routes.
 * The server provides functionalities like chat management, document uploads, 
 * and integration with AWS Bedrock for knowledge retrieval.
 */

import express from "express";
import cors from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import PinnedChats from "./models/pinnedChats.js";

//Imports for document handling
import multer from "multer";
import Document from "./models/document.js";
import fs from "fs";
import { BedrockAgentClient, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";


//import { BedrockAgentRuntimeClient, StartIngestionJobCommand } from "@aws-sdk/client-bedrock";


import { v4 as uuidv4 } from "uuid"; //Import UUID for unique filenames

dotenv.config();

//Initialise Bedrock Agent Runtime Client
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});



// Initialize the S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION, 
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

//Initialize bedrock client

const bedrockClient = new BedrockAgentClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});



const KNOWLEDGE_BASE_ID = "QAMQE57LAY";

// Function to trigger Bedrock Knowledge Base sync after upload
const triggerBedrockIngestion = async (fileKey) => {
  try {
    const input = {
      knowledgeBaseId: KNOWLEDGE_BASE_ID, // required
      dataSourceId: process.env.DATA_SOURCE_ID, // required
      clientToken: uuidv4(), // Ensures idempotency
      description: `Ingestion for file: ${fileKey}`,
    };

    const command = new StartIngestionJobCommand(input);
    const response = await bedrockClient.send(command);
    
    console.log(`✅ Bedrock Ingestion Job Started: ${response.ingestionJob.ingestionJobId}`);
  } catch (error) {
    console.error("❌ Error starting ingestion job in Bedrock:", error);
  }
};


//Function to upload file to s3 and trigger bedrock sync
const uploadFileToS3 = async (fileBuffer, originalFileName, contentType) => {
  const uniqueFileName = `${uuidv4()}-${originalFileName}`;
  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: uniqueFileName,
    Body: fileBuffer,
    ContentType: contentType,
  };

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    console.log("✅ File uploaded to S3:", uniqueFileName);

    // Sync with Bedrock Knowledge Base
    await triggerBedrockIngestion(uniqueFileName);

    return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueFileName}`;
  } catch (error) {
    console.error("❌ Error uploading file to S3:", error);
    throw error;
  }
};

// Function to re-ingest the knowledge base after file deletion
const triggerBedrockReIngestion = async () => {
  try {
    const listParams = { Bucket: process.env.S3_BUCKET_NAME };
    const s3Response = await s3.send(new ListObjectsV2Command(listParams));
    const objectKeys = s3Response.Contents ? s3Response.Contents.map(obj => obj.Key) : [];

    if (objectKeys.length > 0) {
      const input = {
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        dataSourceId: process.env.DATA_SOURCE_ID,
        clientToken: uuidv4(),
        description: "Re-ingestion after file deletion",
      };

      const command = new StartIngestionJobCommand(input);
      const response = await bedrockClient.send(command);
      
      console.log(`✅ Bedrock Knowledge Base Re-indexed. Job ID: ${response.ingestionJob.ingestionJobId}`);
    } else {
      console.log("⚠️ No files left in S3. Skipping re-ingestion.");
    }
  } catch (error) {
    console.error("❌ Error re-indexing Bedrock Knowledge Base:", error);
  }
};


// Define app and port
const port = process.env.PORT || 3000;
const app = express();

// Use correct URL paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CORS Configuration - Only allow frontend domain
const allowedOrigins = [
  "http://localhost:5173", // Development frontend
  "https://v2.amp.pipgpt.ai", //Production Frontend
];

app.use(
  cors({
    origin: allowedOrigins, // Only allow your frontend
    credentials: true, // Enable credentials
  })
);

// Middleware to set CORS headers on all responses
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Express JSON parsing middleware
app.use(express.json());

// MongoDB connection
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Error connecting to MongoDB", err);
  }
};

/*
// ImageKit setup
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});




// ImageKit upload endpoint
app.get("/api/upload", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
});
*/

// API Routes

// POST: Create a new chat
app.post("/api/chats", async (req, res) => {
  const userId = "demouser"; // Using demo user for all requests
  const { text, assistantResponse } = req.body;

  try {
    const newChat = new Chat({
      userId: userId,
      history: [
        { role: "user", content: text },
        { role: "assistant", content: assistantResponse },
      ],
    });

    const savedChat = await newChat.save();
    const userChats = await UserChats.find({ userId: userId });

    if (!userChats.length) {
      const newUserChats = new UserChats({
        userId: userId,
        chats: [
          {
            _id: savedChat._id,
            title: text.substring(0, 30),
          },
        ],
      });
      await newUserChats.save();
    } else {
      await UserChats.updateOne(
        { userId: userId },
        {
          $push: {
            chats: {
              _id: savedChat._id,
              title: text.substring(0, 30),
            },
          },
        }
      );
    }

    res.status(201).json({ chatId: savedChat._id });
  } catch (err) {
    console.error("Error creating chat", err);
    res.status(500).json({ message: "Error creating chat!", error: err.message });
  }
});

// GET: Fetch user chats
app.get("/api/userchats", async (req, res) => {
  const userId = "demouser"; // Using demo user

  try {
    const userChats = await UserChats.find({ userId });
    res.status(200).json(userChats[0]?.chats || []);
  } catch (err) {
    console.error("Error fetching user chats", err);
    res.status(500).send("Error fetching user chats!");
  }
});

// GET: Fetch a single chat by ID
app.get("/api/chats/:id", async (req, res) => {
  const userId = "demouser"; // Using demo user

  try {
    const chat = await Chat.findOne({ _id: new ObjectId(req.params.id), userId });
    res.status(200).send(chat);
  } catch (err) {
    console.error("Error fetching chat", err);
    res.status(500).send("Error fetching chat!");
  }
});

// PUT: Update the chat with a new question and response
app.put("/api/chats/:id", async (req, res) => {
  const userId = "demouser"; // Using demo user
  const { question, assistantResponse } = req.body;

  try {
    const newItems = [
      { role: "user", content: question },
      { role: "assistant", content: assistantResponse },
    ];

    const updatedChat = await Chat.updateOne(
      { _id: new ObjectId(req.params.id), userId },
      {
        $push: {
          history: { $each: newItems },
        },
      }
    );
    res.status(200).send(updatedChat);
  } catch (err) {
    console.error("Error updating chat", err);
    res.status(500).send("Error updating chat!");
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  const userId = "demouser"; // Using demo user
  const chatId = req.params.id;

  try {
    // Remove from UserChats
    await UserChats.updateOne(
      { userId },
      { $pull: { chats: { _id: chatId } } }
    );

    // Remove from PinnedChats
    await PinnedChats.updateOne(
      { userId },
      { $pull: { pinnedChats: { _id: chatId } } }
    );

    // Finally, delete from the Chat collection
    const deletedChat = await Chat.deleteOne({ _id: chatId });

    if (deletedChat.deletedCount > 0) {
      res.status(200).json({ message: "Chat deleted successfully!" });
    } else {
      res.status(404).json({ message: "Chat not found!" });
    }
  } catch (err) {
    console.error("Error deleting chat", err);
    res.status(500).json({ message: "Error deleting chat!" });
  }
});


// PUT: Rename a chat in UserChats or PinnedChats
app.put("/api/chats/:id/rename", async (req, res) => {
  const userId = "demouser"; // Using demo user
  const { newTitle } = req.body;
  const chatId = req.params.id;

  try {
    let updated = await UserChats.updateOne(
      { userId, "chats._id": chatId },
      { $set: { "chats.$.title": newTitle } }
    );

    if (updated.modifiedCount === 0) {
      updated = await PinnedChats.updateOne(
        { userId, "pinnedChats._id": chatId },
        { $set: { "pinnedChats.$.title": newTitle } }
      );
    }

    if (updated.modifiedCount > 0) {
      res.status(200).json({ message: "Chat renamed successfully!" });
    } else {
      res.status(404).json({ message: "Chat not found in UserChats or PinnedChats!" });
    }
  } catch (err) {
    console.error("Error renaming chat", err);
    res.status(500).json({ message: "Error renaming chat!" });
  }
});


// POST: Pin a chat
app.post("/api/pinnedchats", async (req, res) => {
  const userId = "demouser"; // Using demo user
  const { chatId, title } = req.body;

  try {
    let pinnedChats = await PinnedChats.findOne({ userId });
    if (!pinnedChats) {
      pinnedChats = new PinnedChats({ userId, pinnedChats: [] });
    }

    // Check if the chat is already pinned
    const isAlreadyPinned = pinnedChats.pinnedChats.some((chat) => chat._id === chatId);
    if (!isAlreadyPinned) {
      // Add to pinned chats
      pinnedChats.pinnedChats.push({ _id: chatId, title });
      await pinnedChats.save();

      // Remove from user chats
      await UserChats.updateOne(
        { userId },
        { $pull: { chats: { _id: chatId } } }
      );
    }

    res.status(201).json({ message: "Chat pinned successfully!" });
  } catch (err) {
    console.error("Error pinning chat", err);
    res.status(500).json({ message: "Error pinning chat!" });
  }
});

//// Delete: Unpin a chat
app.delete("/api/pinnedchats/:chatId", async (req, res) => {
  const userId = "demouser"; // Using demo user
  const { chatId } = req.params;

  try {
    const pinnedChats = await PinnedChats.findOne({ userId });

    if (pinnedChats) {
      // Find the chat in pinned chats
      const chatToMove = pinnedChats.pinnedChats.find((chat) => chat._id === chatId);

      if (chatToMove) {
        // Remove from pinned chats
        pinnedChats.pinnedChats = pinnedChats.pinnedChats.filter((chat) => chat._id !== chatId);
        await pinnedChats.save();

        // Add back to userChats
        await UserChats.updateOne(
          { userId },
          { $push: { chats: chatToMove } },
          { upsert: true } // Create userChats if not exist
        );
      }
    }

    res.status(200).json({ message: "Chat unpinned successfully!" });
  } catch (err) {
    console.error("Error unpinning chat", err);
    res.status(500).json({ message: "Error unpinning chat!" });
  }
});




// GET: Fetch pinned chats
app.get("/api/pinnedchats", async (req, res) => {
  const userId = "demouser"; // Using demo user

  try {
    const pinnedChats = await PinnedChats.findOne({ userId });
    res.status(200).json(pinnedChats?.pinnedChats || []);
  } catch (err) {
    console.error("Error fetching pinned chats", err);
    res.status(500).json({ message: "Error fetching pinned chats!" });
  }
});



// Health check route
app.get("/", (req, res) => {
  res.send("Backend API is running. Please use the appropriate API endpoints.");
});

// Start the server
app.listen(port, () => {
  connect();
  console.log(`Server running on port ${port}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});



//The following are for documents handling

// Set up Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST: Upload a document (Now stores in AWS S3)
app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  const { userId } = req.body;

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    const fileUrl = await uploadFileToS3(req.file.buffer, req.file.originalname, req.file.mimetype);

    const newDocument = new Document({
      userId,
      fileName: req.file.originalname,
      fileUrl,
      contentType: req.file.mimetype,
    });

    const savedDocument = await newDocument.save();
    res.status(201).json(savedDocument);
  } catch (err) {
    console.error("❌ Error uploading document:", err);
    res.status(500).json({ message: "Error uploading document", error: err.message });
  }
});

// GET: Fetch all documents for a user
app.get("/api/documents", async (req, res) => {
  const { userId } = req.query;

  try {
    const documents = await Document.find({ userId });
    res.status(200).json(documents);
  } catch (err) {
    res.status(500).json({ message: "Error fetching documents", error: err.message });
  }
});


// GET: Fetch a single document (Fetches from S3)
app.get("/api/documents/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ message: "Document not found!" });
    }

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: document.fileUrl.split("/").pop(),
    };

    const command = new GetObjectCommand(params);
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // URL valid for 1 hour

    res.json({ fileUrl: signedUrl });
  } catch (err) {
    res.status(500).json({ message: "Error fetching document", error: err.message });
  }
});



// DELETE: Remove a document (Deletes from S3 and MongoDB)
app.delete("/api/documents/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ message: "Document not found!" });
    }

    const fileKey = document.fileUrl.split("/").pop(); // Extract filename from S3 URL

    // Delete file from S3
    const deleteParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
    };
    await s3.send(new DeleteObjectCommand(deleteParams));
    console.log(`✅ File deleted from S3: ${fileKey}`);

    // Remove document from MongoDB
    await Document.findByIdAndDelete(id);

    // Trigger re-ingestion in Bedrock
    await triggerBedrockReIngestion();

    res.status(200).json({ message: "Document deleted and Bedrock Knowledge Base updated!" });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({ message: "Error deleting document", error: err.message });
  }
});


//Bedrock Chat APIs

// Store chat history per user
const userSessions = {};

// ✅ Retrieve & Generate Response
app.post("/api/retrieve-and-generate", async (req, res) => {
  const { userId, query } = req.body;

  try {
    if (!userSessions[userId]) {
      userSessions[userId] = [];
    }

    const chatHistory = userSessions[userId];
    const conversationContext = chatHistory.slice(-5).join("\n");

    userSessions[userId].push(`User: ${query}`);

    const response = await bedrockAgentRuntimeClient.send(
      new RetrieveAndGenerateCommand({
        input: { text: `Context: ${conversationContext}\nUser: ${query}` },
        retrieveAndGenerateConfiguration: {
          type: "KNOWLEDGE_BASE",
          knowledgeBaseConfiguration: {
            knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
            modelArn: process.env.MODEL_ARN,
          },
        },
        sessionConfiguration: {
          kmsKeyArn: process.env.KMS_KEY_ARN,
        },
      })
    );

    const generatedText = response.output?.text || "No response generated.";
    console.log(`✅ User ${userId}: Retrieved & Generated Response: ${generatedText}`);

    userSessions[userId].push(`Bot: ${generatedText}`);

    res.json({ response: generatedText });
  } catch (error) {
    console.error("❌ Error retrieving from Knowledge Base:", error);
    res.status(500).json({ error: "Error retrieving from Knowledge Base" });
  }
});


// Handling Instant Lookup

//  Function to fetch response based on selected data source
const fetchInstantResponse = async (query, dataSource) => {
  try {
    const dataSources = {
      "amp-data-pipgpt": process.env.DATA_SOURCE_ONE_ID, // AMP Bank Data
      "amp-test-data-2": process.env.DATA_SOURCE_TWO_ID, // DSA Books
    };

    const dataSourceId = dataSources[dataSource];

    if (!dataSourceId) {
      throw new Error(`Invalid data source: ${dataSource}`);
    }


    const response = await bedrockAgentRuntimeClient.send(
      new RetrieveAndGenerateCommand({
        input: { text: `User query: ${query}` },
        retrieveAndGenerateConfiguration: {
          type: "KNOWLEDGE_BASE",
          knowledgeBaseConfiguration: {
            knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
            dataSourceId: dataSourceId, 
            modelArn: process.env.MODEL_ARN,
          },
        },
        sessionConfiguration: {
          kmsKeyArn: process.env.KMS_KEY_ARN,
        },
      })
    );

    return response.output?.text || "No response generated.";
  } catch (error) {
    console.error("❌ Error fetching instant response:", error);
    return "Error retrieving response.";
  }
};




// Api for Instant Lookup

app.post("/api/instant-lookup", async (req, res) => {
  const { query, dataSource } = req.body;

  if (!query || !dataSource) {
    return res.status(400).json({ error: "Query and Data Source are required" });
  }

  try {
    const response = await fetchInstantResponse(query, dataSource);
    
    // Ensure we always send a valid JSON response
    res.json({ response: response || "No response generated." });

  } catch (error) {
    console.error("❌ Error in instant lookup:", error);
    res.status(500).json({ error: "Failed to retrieve response." });
  }
});



app.use("/uploads", express.static(path.join(__dirname, "uploads")));