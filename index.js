import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const feedbackStore = new Map();  // id -> { score, feedback, prompt, userAnswer }

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/api/generate-prompt', async (req, res) => {
  try {
    const promptToModel = `
You are an AP Environmental Science teacher. Write a Free-Response Question (FRQ) prompt suitable for a high school APES exam. The question should ask students to justify, describe, identify, or explain an environmental science concept (you may use multiple verbs).

Use a realistic environmental scenario and divide the prompt into clearly labeled parts, like (a), (b), and (c). 

IMPORTANT: 
- Each part (including part (a)) MUST appear on its own line.
- You must use an HTML <br> tag before each part label (e.g., <br>(a), <br>(b), etc.) so the output is ready for web display.
- Do not place all parts in a single paragraph. Break them into distinct lines using <br>. Think about where to place the <br> tags to make the question readable.
- Only return the prompt text. Do not include explanations or commentary.

Keep the question rigorous but somewhat short; these are only practice questions.

`;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: promptToModel,
    });

    const generatedPrompt = response.text.trim();

    if (!generatedPrompt || generatedPrompt.length < 10) {
      return res.status(500).json({ error: 'Invalid prompt received from Gemini.' });
    }

    res.json({ prompt: generatedPrompt });
  } catch (error) {
    console.error('Error generating prompt with Gemini:', error);
    res.status(500).json({ error: 'Failed to generate prompt' });
  }
});


app.post('/api/grade', async (req, res) => {
  try {
    const { userAnswer, prompt, studentName, classCode } = req.body;

    if (!userAnswer || !prompt) {
      return res.status(400).json({ error: 'Missing userAnswer or prompt' });
    }

    const gradingPrompt = `
    You are an AP Environmental Science grader. Grade the following student response on a scale from 0 to 10 and provide detailed feedback on how the response can be improved. When grading, consider the fact that "identify" problems only require a single correct answer, while "describe" and "explain" problems require a more detailed response. Being concise  in responses can still earn full credit as long as the answer is correct.

    Prompt:
    ${prompt}

    Student Response:
    ${userAnswer}

    Return only a valid JSON object. Do not include any explanation, intro, or text outside the JSON. Format:
    {
      "score": number,
      "feedback": string
    }
    `;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: gradingPrompt,
    });

    const responseText = response.candidates[0].content.parts[0].text.trim();

    // Try to extract JSON using regex as a fallback
    let result;
    try {
      // Direct parse attempt
      result = JSON.parse(responseText);
    } catch (err) {
      try {
        // Extract first {...} block using regex
        const jsonMatch = responseText.match(/{[\s\S]*}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON object found');
        }
      } catch (parseErr) {
        console.error('Could not parse JSON from Gemini response:', responseText);
        return res.status(500).json({ error: 'Could not parse JSON from Gemini response.', raw: responseText });
      }
    }


    const { score, feedback } = result;
    if (typeof score !== 'number' || typeof feedback !== 'string') {
      return res.status(500).json({ error: 'Invalid response format.', raw: result });
    }

    const id = crypto.randomUUID();
    feedbackStore.set(id, {
      score,
      feedback,
      prompt,
      userAnswer,
      studentName: studentName || 'Unknown Student',
      classCode: classCode || 'Unspecified Class'
    });


    res.json({ score, feedbackUrl: `/feedback/${id}` });

  } catch (error) {
    console.error('Error grading FRQ with Gemini:', error);
    console.error('Raw response:', error.response?.data);
    res.status(500).json({ error: 'Failed to grade FRQ' });
  }
});

app.get('/feedback/:id', (req, res) => {
  const id = req.params.id;
  const data = feedbackStore.get(id);

  if (!data) {
    return res.status(404).send('Feedback not found.');
  }

  if (data.classCode !== "mahs") {
    return res.status(403).send('Invalid class code. Unable to generate feedback.');
  }

  res.send(`
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>APES FRQ Feedback</title>
        <style>
          body {
            font-family: 'Inter', sans-serif;
            color: #334155;
            font-size: 14px;
          }
          .feedback-container {
            max-width: 800px;
            margin: 2rem auto;
            padding: 1.5rem;
            background: #f9fafb;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }
          h3 {
            color: #2563eb;
            font-size: 1.5rem;
            margin-bottom: 1rem;
          }
          p {
            line-height: 1.6;
            margin-bottom: 1rem;
          }
          .print-button {
            display: block;
            width: 100%;
            margin-top: 1.5rem;
            padding: 0.75rem;
            text-align: center;
            background-color: #2563eb;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
          }
          /* Print styles */
          @media print {
            body {
              font-family: Arial, sans-serif;
              font-size: 12px;
              color: black;
            }
            .feedback-container {
              max-width: none;
              padding: 0;
              margin: 0;
              box-shadow: none;
              border: none;
            }
            h3 {
              font-size: 1.15rem;
              color: black;
            }
            p {
              line-height: 1.4;
              margin-bottom: 0.5rem;
            }
            .info-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 1rem;
            }
            .info-table, .info-table th, .info-table td {
              border: 1px solid #000000;
            }
            .info-table th, .info-table td {
              padding: 0.5rem;
              text-align: left;
            }
            .print-button {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="feedback-container">
          <table class="info-table">
            <tr>
              <th>Student:</th>
              <td>${data.studentName}</td>
            </tr>
            <tr>
              <th>Class Code:</th>
              <td>${data.classCode}</td>
            </tr>
            <tr>
              <th>Score:</th>
              <td>${data.score} / 10</td>
            </tr>
          </table>
          <h3>Prompt:</h3>
          <p>${data.prompt.replace(/\n/g, '<br>')}</p>
          <h3>Student Answer:</h3>
          <p>${data.userAnswer.replace(/\n/g, '<br>')}</p>
          <h3>Detailed Feedback:</h3>
          <p>${data.feedback.replace(/\n/g, '<br>')}</p>
          <button class="print-button" onclick="window.print()">Create PDF</button>
        </div>
      </body>
    </html>
  `);
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});