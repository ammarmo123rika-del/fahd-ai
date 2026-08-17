FAHD AI - NO API KEY VERSION

This version uses Ollama and a local AI model.
No OpenAI API key is needed.

FEATURES
- Real chat with a local model (Ollama).
- Send attachments: images (vision models like llava) and text files.
- Voice input (mic) and read-aloud replies (speaker) - works in Chrome/Edge.
- Rename, delete, and delete-all-history for chats.
- Change the AI model from Settings (gear icon) - pick an installed model
  or download a new one directly from the app.

SETUP
1. Install Ollama for Windows.
2. Extract this folder.
3. Double-click START_Fahd_AI.cmd.
4. It will download llama3.2 the first time if needed.
5. Fahd AI opens at http://localhost:3000.

CHANGING THE DEFAULT MODEL
- In the app: click Settings (gear) > choose a model or download one.
- Or before starting, set the default model on the command line:
    set FAHD_MODEL=qwen2.5:7b
  then run START_Fahd_AI.cmd (it will download that model if missing).

Keep the black window open while using Fahd AI.
Do not open index.html directly.
