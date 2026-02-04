# Next.js starter kit with Appwrite

Kickstart your Next.js development with this ready-to-use starter project integrated with [Appwrite](https://www.appwrite.io)

## 🚀Getting started

###
Clone the Project
Clone this repository to your local machine using Git:

`git clone https://github.com/appwrite/starter-for-nextjs`

## 🛠️ Development guid
1. **Configure Appwrite**<br/>
   Navigate to `.env` and update the values to match your Appwrite project credentials.
2. **Customize as needed**<br/>
   Modify the starter kit to suit your app's requirements. Adjust UI, features, or backend
   integrations as per your needs.
3. **Install dependencies**<br/>
   Run `npm install` to install all dependencies.
4. **Run the app**<br/>
   Start the project by running `npm run dev`.

## � Database Setup

### Required Tables

The application requires the following tables in your Appwrite TablesDB:

#### `entities`
| Column | Type | Required |
|--------|------|----------|
| label | String | No |
| description | String | No |
| aliases | Array | No |

#### `claims`
| Column | Type | Required |
|--------|------|----------|
| subject_id | String | Yes |
| property_id | String | Yes |
| value_type | String | Yes |
| value | String | No |
| value_entity_id | String | No |
| rank | String | No |

#### `qualifiers`
| Column | Type | Required |
|--------|------|----------|
| claim_id | String | Yes |
| property_id | String | Yes |
| value_type | String | Yes |
| value | String | No |
| value_entity_id | String | No |

#### `references`
| Column | Type | Required |
|--------|------|----------|
| claim_id | String | Yes |
| property_id | String | Yes |
| value_type | String | Yes |
| value | String | No |
| value_entity_id | String | No |

#### `audit_log` (for change history)
| Column | Type | Required | Description |
|--------|------|----------|-------------|
| action | String | Yes | create, update, delete |
| entity_type | String | Yes | entity, claim, qualifier, reference |
| entity_id | String | Yes | ID of the affected entity |
| user_id | String | No | ID of the user who made the change |
| user_name | String | No | Name of the user |
| previous_data | String | No | JSON string of previous data |
| new_data | String | No | JSON string of new data |
| metadata | String | No | Additional JSON metadata |

### Environment Variables

```env
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
NEXT_PUBLIC_APPWRITE_DATABASE_ID=your-database-id
NEXT_PUBLIC_AUTH_ENABLED=true
NEXT_PUBLIC_MAIN_TEAM_ID=main

# Storage Buckets (opcional - para datos grandes como GeoJSON, imágenes, etc.)
NEXT_PUBLIC_BUCKET_IMAGES=images
NEXT_PUBLIC_BUCKET_GEOJSON=geojson
NEXT_PUBLIC_BUCKET_JSON=json
NEXT_PUBLIC_BUCKET_FILES=files
```

> **Nota:** `NEXT_PUBLIC_MAIN_TEAM_ID` es el ID del equipo principal de administradores. Los miembros de este equipo tienen permisos de administrador automáticamente.

### Storage Buckets

Para almacenar datos grandes (GeoJSON, imágenes, JSON extensos), la aplicación utiliza Appwrite Storage. Crea los siguientes buckets en tu proyecto Appwrite:

| Bucket ID | Descripción | Tipos MIME |
|-----------|-------------|------------|
| `images` | Imágenes subidas | image/jpeg, image/png, image/gif, image/webp |
| `geojson` | Archivos GeoJSON grandes | application/geo+json, application/json |
| `json` | JSON genéricos grandes | application/json |
| `files` | Archivos generales | * |

Los datos se suben automáticamente a buckets cuando superan el umbral de 10KB caracteres.

## 🔐 Permissions System

The application uses team-based permissions through Appwrite Teams:

- **Viewers**: Can view all entities and data (default for authenticated users)
- **Editors**: Can create, edit, and delete entities, claims, qualifiers, and references
- **Admins**: Full access including admin panel and audit log viewing

Team roles:
- `owner` / `admin`: Full admin permissions
- `editor`: Edit permissions
- Other roles: View-only permissions

## �💡 Additional notes
- This starter project is designed to streamline your Next.js development with Appwrite.
- Refer to the [Appwrite documentation](https://appwrite.io/docs) for detailed integration guidance.