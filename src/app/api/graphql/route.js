// Hacer petición GraphQL directamente al endpoint de Appwrite
const APPWRITE_ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const APPWRITE_PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

export async function POST(request) {
  try {
    const body = await request.json();
    const { query, variables } = body;

    if (!query) {
      return Response.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // Hacer petición directa al endpoint GraphQL de Appwrite
    const response = await fetch(`${APPWRITE_ENDPOINT}/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
      },
      body: JSON.stringify({
        query,
        variables: variables || {},
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { 
          error: data.message || "Error ejecutando GraphQL query",
          errors: data.errors,
          code: response.status
        },
        { status: response.status }
      );
    }

    return Response.json(data);
  } catch (error) {
    console.error("GraphQL Error:", error);
    
    return Response.json(
      { 
        error: error.message || "Error executing GraphQL query",
        type: "server_error",
        code: 500
      },
      { status: 500 }
    );
  }
}
