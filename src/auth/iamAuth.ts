import axios from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import Auth from './auth';

export default class IamAuth implements Auth {
    // eslint-disable-next-line class-methods-use-this
    initialize(): void {
        // TODO: Grab region value from ENV variable
        const interceptor = aws4Interceptor({
            region: 'us-west-2',
            service: 'execute-api',
        });
        axios.interceptors.request.use(interceptor);
    }
}
