# **MyNaksh Backend \+ AI Engineer Assignment**

# **Build a Personalized AI Context Engine**

At **MyNaksh**, every AI response is personalized based on a user's astrological profile, preferences, and question.Our platform already provides multiple backend services that generate structured astrological information such as **User Profile, Kundli, Horoscope, and Panchang**.

Your task is to build the **Personalized AI Context Engine**—the intelligence layer that sits between these backend services and the LLM.

Its responsibility is to:

* Gather user context from multiple services  
* Understand what the user is asking  
* Select only the relevant context  
* Personalize the response configuration  
* Build an optimized prompt  
* Generate a grounded AI response

**What We Are Evaluating**

This assignment is **not about building another chatbot**. We are interested in how you design the layer **between structured backend services and an LLM**.

Specifically, we want to understand how you:

* Select the right context for a user's question.  
* Design a maintainable and extensible Personalization Engine.  
* Build clean backend services with good engineering practices.  
* Optimize the information sent to the LLM instead of sending everything.  
* Make thoughtful engineering trade-offs.

We care significantly more about **architecture, design decisions, and code quality** than the number of features you implement.

# **AI Usage**

You are free to use AI coding assistants such as Cursor, Claude Code, ChatGPT, GitHub Copilot, or similar tools. During the follow-up discussion, we will focus on your understanding of the implementation, architectural decisions, and engineering trade-offs.

# **Objective**

Implement a backend service exposing the following endpoint.

POST /personalize

Example Request

{  
    "userId": "user\_101",  
    "question": "Should I consider changing my job in the next few months?"  
}

Example Response

{  
    "answer": "...",  
    "confidence": "HIGH",  
    "sourcesUsed": \[  
        "Career Horoscope",  
        "Current Dasha",  
        "10th House"  
    \]  
}

# **Sample User Questions**

Your implementation should be able to handle different kinds of user questions.

Examples:

* Should I consider changing my job this year?  
* How does this month look for my relationship?  
* What should I focus on for my health?  
* What should I prioritize this week?  
* Can you summarize today's guidance?

You are free to support additional question types if you wish.

# **Available Backend Services**

Assume the following services already exist.

You may mock these services locally.

## **User Service**

GET /users/{userId}

{  
  "id": "user\_101",  
  "name": "Aarav Sharma",  
  "language": "en",  
  "subscription": "premium",  
  "tonePreference": "motivational",  
  "birthDetails": {  
    "date": "1997-08-15",  
    "time": "09:35",  
    "place": "Delhi"  
  }  
}

## **Kundli Service**

GET /kundli/{userId}

{  
  "lagna": "Libra",  
  "moonSign": "Scorpio",  
  "currentDasha": {  
    "mahadasha": "Rahu",  
    "antardasha": "Mars"  
  },  
  "houses": {  
    "6": {  
      "lord": "Jupiter",  
      "strength": "Average"  
    },  
    "7": {  
      "lord": "Mars",  
      "strength": "Weak"  
    },  
    "10": {  
      "lord": "Moon",  
      "strength": "Strong"  
    }  
  }  
}

## **Horoscope Service**

GET /horoscope/{userId}

{  
  "career": "Networking may bring new opportunities.",  
  "finance": "Avoid risky investments.",  
  "health": "Prioritize proper sleep.",  
  "relationship": "Communication with your partner improves."  
}

## **Panchang Service**

GET /panchang

{

  "date": "2026-08-01",  
  "tithi": "Shukla Panchami",  
  "nakshatra": "Rohini",  
  "yoga": "Siddhi",  
  "karana": "Bava"  
}

# **Functional Requirements**

Your solution should:

* Fetch all upstream services concurrently.  
* Handle retries, timeouts, and partial failures gracefully.  
* Detect the user's intent (career, relationship, health, finance, general, etc.).  
* Build a **configuration-driven Personalization Engine** that determines what context should be sent to the LLM.  
* Personalize response language, tone, and response length using the user profile.  
* Construct an optimized prompt using only the selected context.  
* Integrate with any LLM provider (or provide a mock implementation if an API key is unavailable).  
* Return a structured response containing the answer, confidence, and sources used.  
* Implement clean logging, basic in-memory caching, and graceful error handling.

# **Personalization Engine**

The Personalization Engine is the **core** of this assignment.

Given a user's question, it should determine:

* What is the user's intent?  
* Which data sources are most relevant?  
* Which data should be ignored?  
* What language should be used?  
* What tone should be used?  
* How detailed should the response be?

We encourage you to design this engine in a way that is **configuration-driven and easily extensible**, rather than relying on large `if/else` blocks.

## **Example Mapping**

You may use a configuration similar to the following (or design your own):

| Intent | Primary Context | Secondary Context | Exclude |
| ----- | ----- | ----- | ----- |
| Career | 10th House, Career Horoscope | Current Dasha, Panchang | Relationship Horoscope |
| Relationship | 7th House, Relationship Horoscope | Moon Sign, Current Dasha | Career Horoscope |
| Health | 6th House, Health Horoscope | Moon Sign, Panchang | Finance Horoscope |
| General | All Available Context | — | — |

We are intentionally **not prescribing the implementation**. The goal is to evaluate how you model and extend these rules.

# **Example Internal Personalization Output**

Your implementation should internally produce something conceptually similar to:

{  
  "intent": "career",  
  "language": "English",  
  "tone": "Motivational",  
  "maxWords": 250,  
  "selectedContext": \[  
    "Career Horoscope",  
    "10th House",  
    "Current Dasha",  
    "Today's Panchang"  
  \],  
  "excludedContext": \[  
    "Relationship Horoscope"  
  \]  
}

This object does **not** need to be returned to the client.

# **Debug Endpoint**

Implement the following endpoint:

POST /debug/personalization

This endpoint should **not** invoke the LLM.

Instead, it should return how your Personalization Engine interpreted the request.

Example Response

{  
  "intent": "career",  
  "selectedContext": \[  
    "Career Horoscope",  
    "10th House",  
    "Current Dasha"  
  \],  
  "excludedContext": \[  
    "Relationship Horoscope"  
  \],  
  "language": "English",  
  "tone": "Motivational"  
}

This endpoint is intended to demonstrate and explain the reasoning behind your personalization decisions.

# **Technical Expectations**

We expect a clean and modular architecture with clear separation of concerns.

Some expectations include:

* Clean project structure.  
* Swappable LLM provider.  
* Extensible Personalization Engine.  
* In-memory caching for upstream services.  
* Request logging.  
* Latency logging.  
* Prompt size logging.  
* Graceful handling of failures.  
* Clear code organization.

# **Deliverables**

Please submit:

* Source Code (ZIP)  
* README  
* Architecture Diagram  
* Run Instructions

Your README should also include: Assumptions, Trade-offs

Describe:

* What you intentionally simplified.  
* What you would improve with another day of development.  
* Which production concerns you left out.