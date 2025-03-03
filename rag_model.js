import express from "express";
import dotenv from "dotenv";
import {v4 as uuidv4} from "uuid";
import {BedrockAgentRuntimeClient, RetriveandGenerateCommand} from "@aws-sdk/client-bedrock-agent"
import {BedrockRuntimeClient, InvokeModelCommand} from  "@aws-sdk/client-bedrock-runtime"

dotenv.config();

const router = express.Router();

//AWS Configuration

const AWS_REGION = process.env.AWS_REGION;
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const MODEL_ARN = process.env.MODEL_ARN;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN;

//Initialise Bedrock Client
const bedrockAgentClient = new BedrockAgentRuntimeClient({region:AWS_REGION});
const bedrockClient = new BedrockRuntimeClient({region:AWS_REGION});

//Store chat history
