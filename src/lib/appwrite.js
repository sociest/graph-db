import { Client, Account, TablesDB, Query, Teams, Graphql, Permission, Role, ID, Storage } from "appwrite";

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);

const account = new Account(client);
const tablesDB = new TablesDB(client);
const teams = new Teams(client);
const graphql = new Graphql(client);
const storage = new Storage(client);

export { client, account, tablesDB, Query, teams, graphql, Permission, Role, ID, storage };
