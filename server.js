
// ROBLOX CHATBOT - SERVER.JS
// Serveur Node.js pour Render

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GAME_SECRET = process.env.GAME_SECRET;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // Récupération du chemin sans les paramètres supplémentaires
    const pathname = new URL(req.url, "http://localhost").pathname;

    function send(status, data) {
        res.writeHead(status);
        res.end(JSON.stringify(data));
    }

    // Vérification du serveur
    if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/health")
    ) {
        return send(200, {
            status: "online",
            message: "Roblox AI server is running"
        });
    }

    // Vérification de la route
    if (req.method !== "POST" || pathname !== "/chat") {
        return send(404, {
            error: "Route introuvable"
        });
    }

    // Vérification des variables Render
    if (!OPENAI_API_KEY || !GAME_SECRET) {
        console.error("Variables serveur manquantes.");
        return send(500, {
            error: "Configuration serveur manquante"
        });
    }

    // Vérification du secret Roblox
    const receivedSecret = req.headers["x-game-secret"] || "";

    const expected = Buffer.from(GAME_SECRET);
    const received = Buffer.from(receivedSecret);

    if (
        expected.length !== received.length ||
        !crypto.timingSafeEqual(expected, received)
    ) {
        console.error("Secret Roblox incorrect.");
        return send(401, {
            error: "Accès refusé"
        });
    }

    try {
        // Lecture du message Roblox
        let body = "";

        for await (const chunk of req) {
            body += chunk;

            if (Buffer.byteLength(body, "utf8") > 20000) {
                return send(413, {
                    error: "Message trop volumineux"
                });
            }
        }

        const data = JSON.parse(body);

        if (
            typeof data.prompt !== "string" ||
            data.prompt.trim().length === 0 ||
            data.prompt.length > 3000
        ) {
            return send(400, {
                error: "Message invalide"
            });
        }

        console.log("Message reçu de Roblox.");

        // Préparation de l'historique
        const history = Array.isArray(data.history)
            ? data.history.slice(-12)
            : [];

        const input = history
            .filter(item =>
                item &&
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string"
            )
            .map(item => ({
                role: item.role,
                content: item.content.slice(0, 5000)
            }));

        // Ajouter le nouveau message
        input.push({
            role: "user",
            content: data.prompt.trim()
        });

        console.log("Envoi de la question à OpenAI...");

        // Appel à l'API OpenAI
        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, 100000);

        let response;

        try {
            response = await fetch(
                "https://api.openai.com/v1/responses",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: OPENAI_MODEL,
                        instructions: "Tu es un assistant utile et bienveillant dans un jeu Roblox. Réponds clairement en français lorsque l'utilisateur écrit en français. Respecte la sécurité des jeunes utilisateurs.",
                        input: input,
                        max_output_tokens: 500
                    }),
                    signal: controller.signal
                }
            );
        } finally {
            clearTimeout(timeout);
        }

        const result = await response.json();

        if (!response.ok) {
            console.error(
                "Erreur OpenAI :",
                response.status,
                result.error?.message || "Erreur inconnue"
            );

            return send(502, {
                error: "Erreur du service IA"
            });
        }

        // Récupération de la réponse
        const reply = result.output_text;

        if (typeof reply !== "string" || !reply.trim()) {
            console.error("Réponse IA vide.");

            return send(502, {
                error: "Réponse IA vide"
            });
        }

        console.log("Réponse OpenAI reçue.");

        // Réponse envoyée à Roblox
        return send(200, {
            reply: reply.trim()
        });

    } catch (error) {
        console.error(
            "Erreur serveur :",
            error.name,
            error.message
        );

        if (error.name === "AbortError") {
            return send(504, {
                error: "Délai dépassé pendant la demande IA"
            });
        }

        return send(500, {
            error: "Erreur interne du serveur"
        });
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Serveur IA démarré sur le port ${PORT}`);
});
