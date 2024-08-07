import {
  LocoSyncClient,
  createConfig,
  ModelsRelationshipDefs,
  many,
  one,
} from '@loco-sync/client';
import { createLocoSyncIdbAdapter } from '@loco-sync/idb';
import { createLocoSyncReact } from '@loco-sync/react';
import { network } from './network';
import { useState } from 'react';

type M = {
  Person: {
    id: string;
    name: string;
  };
  Pet: {
    id: string;
    type: string;
    breed: string;
    ownerId: string;
  };
  Hobby: {
    id: string;
    name: string;
  };
  PersonHobby: {
    id: string;
    personId: string;
    hobbyId: string;
  };
};

const relationshipDefs = {
  Person: {
    pets: many('Pet', {
      fields: ['id'],
      references: ['ownerId'],
    }),
    hobbies: many('PersonHobby', {
      fields: ['id'],
      references: ['personId'],
    }),
  },
  Pet: {
    owner: one('Person', {
      fields: ['ownerId'],
      references: ['id'],
    }),
  },
  PersonHobby: {
    person: one('Person', {
      fields: ['personId'],
      references: ['id'],
    }),
    hobby: one('Hobby', {
      fields: ['hobbyId'],
      references: ['id'],
    }),
  },
  Hobby: {
    people: many('PersonHobby', {
      fields: ['id'],
      references: ['hobbyId'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

type R = typeof relationshipDefs;

export type MS = {
  models: M;
  relationshipDefs: R;
};

const config = createConfig<MS>({
  modelDefs: {
    Person: { initialBootstrap: true },
    Pet: { initialBootstrap: true },
    Hobby: { initialBootstrap: true },
    PersonHobby: { initialBootstrap: true },
  },
  relationshipDefs,
});

const client = new LocoSyncClient({
  config,
  network,
  storage: createLocoSyncIdbAdapter('example1', config),
});

const loco = createLocoSyncReact(config);

export const App = () => {
  return (
    <loco.Provider client={client} notHydratedFallback={<div>Loading...</div>}>
      <Content />
    </loco.Provider>
  );
};

const Content = () => {
  const { data, isHydrated } = loco.useQuery(
    'Person',
    {},
    {
      pets: {},
      hobbies: {
        hobby: {},
      },
    },
  );
  const [searchInput, setSearchInput] = useState('');

  if (!isHydrated) {
    return <div>Loading...</div>;
  }

  const filteredData = data.filter((person) => {
    if (searchInput === '') {
      return true;
    }
    if (textMatchesSearch(person.name, searchInput)) {
      return true;
    }
    if (person.pets?.some((pet) => textMatchesSearch(pet.type, searchInput))) {
      return true;
    }
    if (
      person.pets?.some((pet) => textMatchesSearch(pet.breed, searchInput))
    ) {
      return true;
    }
    if (
      person.hobbies?.some((personHobby) =>
        textMatchesSearch(personHobby.hobby?.name ?? '', searchInput),
      )
    ) {
      return true;
    }
    return false;
  });

  return (
    <div>
      <input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      {filteredData.map((person) => (
        <div
          key={person.id}
          style={{
            borderBottom: '1px solid black',
          }}
        >
          <span>Name: {person.name}</span>
          <br/>
          <span>Pets:</span>
          <ul>
            {person.pets?.map((pet) => (
              <li key={pet.id}>
                {pet.type} - {pet.breed}
              </li>
            ))}
          </ul>
          <br/>
          <span>Hobbies:</span>
          <ul>
            {person.hobbies?.map((personHobby) => (
              <li key={personHobby.id}>{personHobby.hobby?.name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

function textMatchesSearch(text: string, search: string) {
  return text.toLowerCase().includes(search.toLowerCase());
}
