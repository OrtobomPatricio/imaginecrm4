import { useState } from "react";
import { LayoutList, Kanban as KanbanIcon } from "lucide-react";
import Leads from "./Leads";
import Kanban from "./Kanban";

export default function LeadsModule() {
    // Lee el parámetro ?view=kanban de la URL para activar la vista correcta
    const searchParams = new URLSearchParams(window.location.search);
    const initialView = searchParams.get("view") === "kanban" ? "board" : "list";
    const [view, setView] = useState<"list" | "board">(initialView);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 bg-muted p-1 rounded-lg">
                    <button
                        onClick={() => setView("list")}
                        className={`p-2 rounded-md transition-all ${view === "list"
                            ? "bg-background shadow text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                        title="Vista de Lista"
                    >
                        <LayoutList className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setView("board")}
                        className={`p-2 rounded-md transition-all ${view === "board"
                            ? "bg-background shadow text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                        title="Vista de Tablero (Pipeline)"
                    >
                        <KanbanIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="min-h-[calc(100vh-140px)]">
                {view === "list" ? <Leads /> : <Kanban />}
            </div>
        </div>
    );
}
