export type Task = {
  id: string;
  task: string;
  startTime: string; // "HH:mm"
  endTime: string;
  done: boolean;
  googleEventId?: string;
};

export type Goal = {
  id: string;
  text: string;
  done: boolean;
  googleEventId?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DayDoc = {
  id: string;
  user_id: string;
  day_date: string;
  tasks: Task[];
  goals: Goal[];
  messages: ChatMessage[];
  confirmed: boolean;
  synced_event_ids?: string[];
};
