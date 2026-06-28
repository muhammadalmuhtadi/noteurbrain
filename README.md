# Noturbrain 🧠

Noturbrain is a private, local-first **Second Brain** application designed to help you organize thoughts, link pages, search notes, and visualize connections. All your notes are stored locally in an SQLite database that is synchronized in real-time with a file on your disk using the browser's File System Access API.

## Features

- **Local SQLite Database Syncing**: Keep absolute control of your data. The app connects directly to a `.sqlite` file on your local disk, automatically saving and syncing changes.
- **Web Clipper**: Import pages directly from the web! Enter any URL, and the server-side clipper scrapes the content, converts the HTML to clean Markdown, and saves it as a new note in your selected section.
- **Visual Connection Graph**: View your note connections dynamically. Uses a physics-simulated force graph to link notes that mention each other via `@Note Title` references.
- **Interactive Graph Filters**: Filter the visual graph dynamically by notebook, section, or connection distance (BFS degrees of separation) relative to the focused note.
- **Rich Editor with Live Previews**: Markdown editing powered by CodeMirror, featuring left-click backlinks navigation and hover previews of linked notes.
- **Backlinks & Full-Text Search**: Instantly see which notes refer to the current page, and use lightning-fast search to find terms across all documents.

## Getting Started

### Prerequisites

Make sure you have Node.js installed (version 18 or higher recommended).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/muhammadalmuhtadi/noturbrain.git
   cd noturbrain
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to the address shown in your terminal (usually `http://localhost:8080` or `http://localhost:8081`).

### Build for Production

To build the static application bundle:
```bash
npm run build
```
The optimized bundle will be generated in the `.output/public` folder.
