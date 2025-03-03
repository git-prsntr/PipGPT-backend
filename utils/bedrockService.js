import { BedrockAgentRuntimeClient, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import dotenv from "dotenv";

dotenv.config();

const AWS_REGION = process.env.AWS_REGION;
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const MODEL_ARN = process.env.MODEL_ARN;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN;

// Store chat history per user
const userSessions = {};

// Initialize Amazon Bedrock Clients
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({ region: AWS_REGION });
const bedrockRuntimeClient = new BedrockRuntimeClient({ region: AWS_REGION });

// **Retrieve & Generate Response (RAG)**
export const retrieveAndGenerateResponse = async (query, userId) => {
    try {
        if (!userSessions[userId]) {
            userSessions[userId] = [];
        }

        const chatHistory = userSessions[userId];
        const conversationContext = chatHistory.slice(-5).join("\n");

        userSessions[userId].push(`User: ${query}`);

        const response = await bedrockAgentRuntimeClient.send({
            input: { text: `Context: ${conversationContext}\nUser: ${query}` },
            retrieveAndGenerateConfiguration: {
                type: "KNOWLEDGE_BASE",
                knowledgeBaseConfiguration: {
                    knowledgeBaseId: KNOWLEDGE_BASE_ID,
                    modelArn: MODEL_ARN
                }
            },
            sessionConfiguration: {
                kmsKeyArn: KMS_KEY_ARN
            }
        });

        const generatedText = response.output?.text || "No response generated.";
        console.log(`✅ User ${userId}: Retrieved & Generated Response: ${generatedText}`);

        userSessions[userId].push(`Bot: ${generatedText}`);

        return generatedText;
    } catch (error) {
        console.error("❌ Error retrieving from Knowledge Base:", error);
        return "Error retrieving from Knowledge Base";
    }
};

// **Generate Response using Bedrock LLM (General AI)**
export const generateWithBedrock = async (query, userId) => {
    try {
        if (!userSessions[userId]) {
            userSessions[userId] = [];
        }

        const chatHistory = userSessions[userId];
        const conversationContext = chatHistory.slice(-5).join("\n");

        userSessions[userId].push(`User: ${query}`);

        const response = await bedrockRuntimeClient.send({
            modelId: "mistral.mistral-small-2402-v1",
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
                prompt: `Context: ${conversationContext}\nUser: ${query}`,
                max_tokens: 200,
                temperature: 0.5,
                top_p: 0.9,
                top_k: 50
            })
        });

        const responseData = JSON.parse(response.body.read().toString("utf-8"));
        console.log("✅ Generated Response:", responseData);

        const assistantResponse = responseData.outputs?.[0]?.text || "No response generated.";
        userSessions[userId].push(`Bot: ${assistantResponse}`);

        return assistantResponse;
    } catch (error) {
        console.error("❌ Error generating response:", error);
        return "Error in AI generation";
    }
};
