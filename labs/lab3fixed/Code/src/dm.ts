import { assign, createActor, setup } from "xstate";
import type { Settings } from "speechstate";
import { speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import type { DMContext, DMEvents } from "./types";

/* ---------------- Inspector ---------------- */
const inspector = createBrowserInspector();

/* ---------------- Azure settings ---------------- */
const azureCredentials = {
  endpoint: "https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials,
  azureRegion: "swedencentral",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

/* ---------------- Grammar ---------------- */
interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
}

const grammar: { [index: string]: GrammarEntry } = {
  // people
  vlad: { person: "Vladislav Maraev" },
  bora: { person: "Bora Kara" },
  tal: { person: "Talha Bedir" },
  tom: { person: "Tom Södahl Bladsjö" },
  emma: { person: "Emma Collins" },
  liam: { person: "Liam Parket" },
  sofia: { person: "Sofia Bennett" },
  yeganeh: { person: "Yeganeh Vahabi" },

  // days
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  wednesday: { day: "Wednesday" },
  thursday: { day: "Thursday" },
  friday: { day: "Friday" },
  saturday: { day: "Saturday" },
  sunday: { day: "Sunday" },

  // times
  "9":  { time: "09:00" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
  "12": { time: "12:00" },
  "13": { time: "13:00" },
  "14": { time: "14:00" },
  "15": { time: "15:00" },
  "16": { time: "16:00" },
  "17": { time: "17:00" },
  "18": { time: "18:00" },
  "19": { time: "19:00" },
  "20": { time: "20:00" },

};

const yesNoGrammar: { [index: string]: boolean } = {
  // yes‑like
  yes: true,
  yeah: true,
  yep: true,
  "of course": true,
  sure: true,
  absolutely: true,
  definitely: true,
  "for sure": true,
  "why not": true,
  "sounds good": true,
  ok: true,
  okay: true,
  alright: true,

  // no‑like
  no: false,
  nope: false,
  "no way": false,
  never: false,
  nah: false,
  "not really": false,
  "i don't think so": false,
  "absolutely not": false,
  "definitely not": false,
};

/* ---------------- Helper functions ---------------- */
function getGreeting(utterance: string) {
  const text = utterance.toLowerCase();

  const greetings = [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
  ];

  return greetings.find(g => text.includes(g));
}

function getYesNo(utterance: string): boolean | null {
  const key = utterance.toLowerCase();
  return key in yesNoGrammar ? yesNoGrammar[key] : null;
}

function getDay(utterance: string) {
  return grammar[utterance.toLowerCase()]?.day;
}

function getTime(utterance: string) {
  return grammar[utterance.toLowerCase()]?.time;
}

function getPerson(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).person;
}


/* ---------------- Dialogue Manager ---------------- */
const dmMachine = setup({
  types: {
    context: {} as DMContext & {
      person?: string; // what the context looks like
      day?: string;
      time?: string;
      wholeDay?: boolean;
      confirm?: boolean;
    },
    events: {} as DMEvents, // what events are allowed
  },

  actions: {
    // for speaking
    "spst.speak": ({ context }, params: { utterance: string }) => {
      context.spstRef.send({
        type: "SPEAK",
        value: { utterance: params.utterance },
      });
    },

    // for listening
    "spst.listen": ({ context }) => {
      context.spstRef.send({ type: "LISTEN" });
    },
  },
}).createMachine({
  // machine metadata
  id: "DM",
  initial: "Prepare",
  deferEvents: true, 

  // memory of the dialogue context
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,

    person: undefined,
    day: undefined,
    time: undefined,
    wholeDay: undefined,
    confirm: undefined,
  }),

  states: {
    /* -------- PREPARE -------- */
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },


    /* -------- START -------- */
    WaitToStart: {
      entry: assign({
        person: undefined,
        day: undefined,
        time: undefined,
        wholeDay: undefined,
        confirm: undefined,
      }),
      on: { 
        CLICK: "ListenHi",
      },
    },

    ListenHi: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          guard: ({ event }) => 
            !!getGreeting(event.value[0].utterance), 
          actions: assign(({ event }) => ({ 
            lastResult: event.value, 
          })), 
        },
        LISTEN_COMPLETE: [
          {
            target: "Introduction",
            guard: ({context}) => !!context.lastResult,
          },
          {
            target: "SayHi",
          }
        ],
      },
    },

    SayHi: {
      entry: { 
        type: "spst.speak", 
        params: { utterance: "Hi!" } 
      },
      on: { SPEAK_COMPLETE: "ListenHi" }
    },

    Introduction: {
      entry: { 
        type: "spst.speak", 
        params: { utterance: "Let's create an appointment!" } 
      },
      on: { SPEAK_COMPLETE: "AskPerson" }
    },

    /* -------- PERSON -------- */
    AskPerson: {
      entry: { 
        type: "spst.speak", 
        params: { utterance: "Who are you meeting with?" } 
      },
      on: { SPEAK_COMPLETE: "ListenPerson" }
    },

    ListenPerson: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          actions: assign(({ event }) => ({
            lastResult: event.value,
            person: getPerson(event.value[0].utterance),
          })),
        },
        LISTEN_COMPLETE: [
          {
            target: "AskDay",
            guard: ({context}) => !!context.person,
          },
          {
            target: "AskPerson",
          }
        ],
      },
    },


    /* -------- DAY -------- */
    AskDay: {
      entry: {
        type: "spst.speak",
        params: { utterance: "On which day is your meeting?" },
      },
      on: { SPEAK_COMPLETE: "ListenDay" },
    },

    ListenDay: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          actions: assign(({ event }) => ({
            lastResult: event.value,
            day: getDay(event.value[0].utterance),
          })),
        },
        LISTEN_COMPLETE: [
          {
            target: "AskWholeDay",
            guard: ({context}) => !!context.day,
          },
          {
            target: "AskDay",
          }
        ],
      },
    },


    /* -------- WHOLE DAY -------- */
    AskWholeDay: {
      entry: {
        type: "spst.speak",
        params: { utterance: "Will it take the whole day?" },
      },
      on: { SPEAK_COMPLETE: "ListenWholeDay" },
    },

    ListenWholeDay: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: [
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === true,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              wholeDay: true,
          })),
          },
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === false,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              wholeDay: false,
          })),
          },
        ],
        LISTEN_COMPLETE: [
          {
            target: "Confirm",
            guard: ({context}) => context.wholeDay === true,
          },
          {
            target: "AskTime",
            guard: ({context}) => context.wholeDay === false,
          },
          {
            target: "AskWholeDay",
          }
        ],
      },
    },


    /* -------- TIME -------- */
    AskTime: {
      entry: {
        type: "spst.speak",
        params: { utterance: "What time is your meeting?" },
      },
      on: { SPEAK_COMPLETE: "ListenTime" },
    },

    ListenTime: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: {
          actions: assign(({ event }) => ({
            lastResult: event.value,
            time: getTime(event.value[0].utterance),
          })),
        },
        LISTEN_COMPLETE: [
          {
            target: "ConfirmWithTime",
            guard: ({context}) => !!context.time,
          },
          {
            target: "AskTime",
          }
        ],
      },
    },


    /* -------- CONFIRMs -------- */
    ConfirmWithTime: {
      entry: {
        type:"spst.speak",
        params: ({ context }) => ({
          utterance: `Do you want me to create an appointment with ${context.person} on ${context.day} at ${context.time}?`,
        }),
      },
      on:  { SPEAK_COMPLETE: "ListenConfirmWithTime" },
    },

    ListenConfirmWithTime: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: [
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === true,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              confirm: true,
          })),
          },
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === false,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              confirm: false,
          })),
          },
        ],
        LISTEN_COMPLETE: [
          {
            target: "Done",
            guard: ({context}) => context.confirm === true,
          },
          {
            target: "AskPerson",
            guard: ({context}) => context.confirm === false,
          },
          {
            target: "ConfirmWithTime",
          }
        ],
      },
    },


    Confirm: {
      entry: {
        type:"spst.speak",
        params: ({ context }) => ({
          utterance: `Do you want me to create an appointment with ${context.person} on ${context.day} for the whole day?`,
        }),
      },
      on:  { SPEAK_COMPLETE: "ListenConfirm" },
    },


    ListenConfirm: {
      entry: { type: "spst.listen" },
      on: {
        RECOGNISED: [
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === true,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              confirm: true,
          })),
          },
          {
            guard: ({ event }) => getYesNo(event.value[0].utterance) === false,
            actions: assign(({ event }) => ({
              lastResult: event.value,
              confirm: false,
          })),
          },
        ],
        LISTEN_COMPLETE: [
          {
            target: "Done",
            guard: ({context}) => context.confirm === true,
          },
          {
            target: "AskPerson",
            guard: ({context}) => context.confirm === false,
          },
          {
            target: "ConfirmWithTime",
          }
        ],
      },
    },


    /* -------- DONE -------- */
    Done: {
      entry: {
        type: "spst.speak",
        params: { utterance: "Your appointment has been created!" },
      },
      on: { CLICK: "WaitToStart" },
    },
  },
});


/* ---------------- Actor ---------------- */
const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

/* ---------------- Button ---------------- */
export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
