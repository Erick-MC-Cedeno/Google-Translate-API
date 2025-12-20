import 'styled-components';

declare module 'styled-components' {
  export interface DefaultTheme {
    primary: {
      main: string;
      400?: string;
      500?: string;
      600?: string;
      700?: string;
      contrastText?: string;
    };
  }
}
