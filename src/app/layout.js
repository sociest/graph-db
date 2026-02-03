import Providers from "./providers";

export const metadata = {
  title: "Graph DB Explorer",
  description: "Explorador de entidades estilo Wikidata",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="icon" href="/appwrite.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code&family=Inter:opsz,wght@14..32,100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={"bg-[#f8f9fa] font-[Inter] text-sm text-[#202122]"}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
